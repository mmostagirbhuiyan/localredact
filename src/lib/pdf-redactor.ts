import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFDocument, PDFName } from 'pdf-lib';
import type { PDFPageInfo } from '../hooks/usePDFParser';
import type { DetectedEntity } from './entity-types';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

interface BoundingBox {
  pageIndex: number;
  x: number;      // PDF points, from left
  y: number;      // PDF points, from top (canvas-style, already flipped)
  width: number;
  height: number;
}

/**
 * Find which page(s) an entity belongs to based on its character offsets.
 */
function findEntityPages(
  entity: DetectedEntity,
  pages: PDFPageInfo[],
): PDFPageInfo[] {
  return pages.filter(
    (p) => entity.start < p.textEnd && entity.end > p.textStart,
  );
}

/**
 * Find bounding boxes for an entity's text within a page's text items.
 * Searches for the entity text in the page's text items and returns
 * the bounding rectangles in PDF coordinate space (converted to top-left origin).
 */
function findTextItemBounds(
  entityText: string,
  textItems: TextItem[],
  pageHeight: number,
): BoundingBox[] {
  const boxes: BoundingBox[] = [];

  // Build a mapping of concatenated text positions to text items.
  // Must mirror the spacing logic from extractPageText() so entity text
  // found in the formatted text can be located in the raw items.
  let concat = '';
  const itemRanges: { item: TextItem; start: number; end: number }[] = [];

  let prevItem: TextItem | null = null;
  for (const item of textItems) {
    // Insert synthetic spaces/newlines matching extractPageText logic
    if (prevItem) {
      const prevX = prevItem.transform[4];
      const prevY = prevItem.transform[5];
      const curX = item.transform[4];
      const curY = item.transform[5];
      const lineHeight = Math.abs(prevItem.transform[3]) || 12;

      if (Math.abs(curY - prevY) > lineHeight * 0.5) {
        if (!concat.endsWith('\n')) concat += '\n';
      } else {
        const prevEnd = prevX + prevItem.width;
        const gap = curX - prevEnd;
        const avgCharWidth = prevItem.str.length > 0
          ? prevItem.width / prevItem.str.length
          : lineHeight * 0.5;
        if (gap > avgCharWidth * 1.5 && !prevItem.str.endsWith(' ') && !item.str.startsWith(' ')) {
          concat += ' ';
        }
      }
    }

    const start = concat.length;
    concat += item.str;
    itemRanges.push({ item, start, end: concat.length });
    if (item.hasEOL) {
      concat += '\n';
    }
    prevItem = item;
  }

  // Find all occurrences of entity text in concatenated items
  let searchFrom = 0;
  while (searchFrom < concat.length) {
    const idx = concat.indexOf(entityText, searchFrom);
    if (idx === -1) break;

    const entityEnd = idx + entityText.length;

    // Find all text items that overlap with this occurrence
    for (const range of itemRanges) {
      if (range.end <= idx || range.start >= entityEnd) continue;

      const item = range.item;
      const fontSize = Math.abs(item.transform[3]) || 12;
      const itemX = item.transform[4];
      const itemY = item.transform[5];

      const overlapStart = Math.max(0, idx - range.start);
      const overlapEnd = Math.min(item.str.length, entityEnd - range.start);
      const coversFullItem = overlapStart === 0 && overlapEnd === item.str.length;

      let boxX: number;
      let boxWidth: number;

      if (coversFullItem) {
        // Use exact item bounds — no character width estimation needed
        boxX = itemX;
        boxWidth = item.width;
      } else {
        // Partial coverage: estimate with average char width + padding
        const charWidth = item.str.length > 0 ? item.width / item.str.length : fontSize * 0.6;
        boxX = itemX + overlapStart * charWidth;
        boxWidth = (overlapEnd - overlapStart) * charWidth;
      }

      // Add horizontal padding to ensure full coverage with proportional fonts
      const hPad = fontSize * 0.1;
      boxX -= hPad;
      boxWidth += hPad * 2;

      // Flip Y: PDF origin is bottom-left, canvas is top-left
      const boxY = pageHeight - itemY - fontSize;

      boxes.push({
        pageIndex: 0, // filled in by caller
        x: boxX,
        y: boxY,
        width: boxWidth,
        height: fontSize * 1.4, // padding for ascenders/descenders
      });
    }

    searchFrom = idx + 1;
  }

  // Merge overlapping/adjacent boxes on the same line
  return mergeBoxes(boxes);
}

/**
 * Merge overlapping or adjacent bounding boxes on the same line.
 */
function mergeBoxes(boxes: BoundingBox[]): BoundingBox[] {
  if (boxes.length <= 1) return boxes;

  // Sort by Y then X
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: BoundingBox[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];

    // Same line (Y within threshold) and overlapping/adjacent horizontally
    const sameLine = Math.abs(curr.y - prev.y) < prev.height * 0.5;
    const overlaps = curr.x <= prev.x + prev.width + 2; // 2pt tolerance

    if (sameLine && overlaps) {
      const newEnd = Math.max(prev.x + prev.width, curr.x + curr.width);
      prev.x = Math.min(prev.x, curr.x);
      prev.width = newEnd - prev.x;
      prev.height = Math.max(prev.height, curr.height);
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

/**
 * Map all accepted entities to bounding boxes across PDF pages.
 */
export function mapEntitiesToBounds(
  entities: DetectedEntity[],
  pages: PDFPageInfo[],
): Map<number, BoundingBox[]> {
  const pageBoxes = new Map<number, BoundingBox[]>();

  const accepted = entities.filter((e) => e.accepted);

  for (const entity of accepted) {
    const entityPages = findEntityPages(entity, pages);

    for (const page of entityPages) {
      const boxes = findTextItemBounds(
        entity.text,
        page.textItems,
        page.height,
      );

      const existing = pageBoxes.get(page.pageIndex) || [];
      for (const box of boxes) {
        box.pageIndex = page.pageIndex;
        existing.push(box);
      }
      pageBoxes.set(page.pageIndex, existing);
    }
  }

  return pageBoxes;
}

const RENDER_SCALE = 3; // ~216 DPI (72 * 3), good balance of quality vs performance

/**
 * Render a single PDF page to a canvas with black boxes over redacted regions.
 */
async function renderRedactedPage(
  pdfDoc: PDFDocumentProxy,
  pageIndex: number,
  boxes: BoundingBox[],
): Promise<HTMLCanvasElement> {
  const page = await pdfDoc.getPage(pageIndex + 1); // pdfjs is 1-indexed
  const viewport = page.getViewport({ scale: RENDER_SCALE });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;

  // Render the original page
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Draw black boxes over PII
  ctx.fillStyle = '#000000';
  for (const box of boxes) {
    ctx.fillRect(
      box.x * RENDER_SCALE,
      box.y * RENDER_SCALE,
      box.width * RENDER_SCALE,
      box.height * RENDER_SCALE,
    );
  }

  return canvas;
}

/**
 * Convert canvas to PNG bytes.
 */
function canvasToPNG(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to convert canvas to PNG'));
          return;
        }
        blob.arrayBuffer().then(
          (buf) => resolve(new Uint8Array(buf)),
          reject,
        );
      },
      'image/png',
    );
  });
}

/**
 * Produce a redacted PDF: each page is rendered to an image with black boxes,
 * then assembled into a new image-only PDF. No original text survives.
 */
export async function createRedactedPDF(
  pdfDoc: PDFDocumentProxy,
  entities: DetectedEntity[],
  pages: PDFPageInfo[],
  onProgress?: (current: number, total: number) => void,
): Promise<Uint8Array> {
  const pageBoxes = mapEntitiesToBounds(entities, pages);
  const totalPages = pdfDoc.numPages;
  const outputPdf = await PDFDocument.create();

  for (let i = 0; i < totalPages; i++) {
    onProgress?.(i + 1, totalPages);

    const boxes = pageBoxes.get(i) || [];
    const canvas = await renderRedactedPage(pdfDoc, i, boxes);
    const pngBytes = await canvasToPNG(canvas);

    const pngImage = await outputPdf.embedPng(pngBytes);
    const page = outputPdf.addPage([pages[i].width, pages[i].height]);
    page.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pages[i].width,
      height: pages[i].height,
    });
  }

  // Sanitize metadata — Info dict
  outputPdf.setTitle('');
  outputPdf.setAuthor('');
  outputPdf.setSubject('');
  outputPdf.setKeywords([]);
  outputPdf.setProducer('LocalRedact');
  outputPdf.setCreator('');
  outputPdf.setCreationDate(new Date(0));
  outputPdf.setModificationDate(new Date(0));

  // Strip XMP metadata if present (shouldn't be on a fresh doc, but defensive)
  const catalog = outputPdf.context.lookup(outputPdf.context.trailerInfo.Root);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const catalogDict = catalog as any;
  if (catalogDict && typeof catalogDict.delete === 'function') {
    catalogDict.delete(PDFName.of('Metadata'));
  }

  return outputPdf.save();
}
