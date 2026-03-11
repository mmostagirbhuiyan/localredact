import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
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

  // Build a mapping of concatenated text positions to text items
  // This lets us find which text items contain our entity text
  let concat = '';
  const itemRanges: { item: TextItem; start: number; end: number }[] = [];

  for (const item of textItems) {
    const start = concat.length;
    concat += item.str;
    itemRanges.push({ item, start, end: concat.length });
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

      // Calculate partial coverage if entity only covers part of this item
      const overlapStart = Math.max(0, idx - range.start);
      const overlapEnd = Math.min(item.str.length, entityEnd - range.start);
      const charWidth = item.str.length > 0 ? item.width / item.str.length : fontSize * 0.6;

      const boxX = itemX + overlapStart * charWidth;
      const boxWidth = (overlapEnd - overlapStart) * charWidth;

      // Flip Y: PDF origin is bottom-left, canvas is top-left
      const boxY = pageHeight - itemY - fontSize;

      boxes.push({
        pageIndex: 0, // filled in by caller
        x: boxX,
        y: boxY,
        width: boxWidth,
        height: fontSize * 1.3, // slight padding for descenders
      });
    }

    searchFrom = idx + 1;
  }

  return boxes;
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

  // Sanitize metadata
  outputPdf.setTitle('');
  outputPdf.setAuthor('');
  outputPdf.setSubject('');
  outputPdf.setKeywords([]);
  outputPdf.setProducer('LocalRedact');
  outputPdf.setCreator('');

  return outputPdf.save();
}
