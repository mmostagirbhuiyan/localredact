import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFDocument, PDFName } from 'pdf-lib';
import type { PDFPageInfo } from '../hooks/usePDFParser';
import type { DetectedEntity } from './entity-types';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { OCRLine, OCRPageResult, OCRWord } from '../hooks/useOCR';

export interface BoundingBox {
  pageIndex: number;
  x: number;      // PDF points, from left
  y: number;      // PDF points, from top (canvas-style, already flipped)
  width: number;
  height: number;
}

interface TextItemRange {
  item: TextItem;
  start: number;
  end: number;
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

function findTextItemBoundsForEntity(
  entity: DetectedEntity,
  page: PDFPageInfo,
): BoundingBox[] {
  const targetStart = Math.max(0, entity.start - page.textStart);
  const targetEnd = Math.min(page.textEnd, entity.end) - page.textStart;

  if (targetEnd <= targetStart || targetStart < 0) {
    return findTextItemBounds(entity.text, page.textItems, page.height);
  }

  let concat = '';
  const itemRanges: TextItemRange[] = [];

  let prevItem: TextItem | null = null;
  for (const item of page.textItems) {
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

  const boxes: BoundingBox[] = [];
  const boundedEnd = Math.min(targetEnd, concat.length);

  for (const range of itemRanges) {
    if (range.end <= targetStart || range.start >= boundedEnd) continue;

    const item = range.item;
    const fontSize = Math.abs(item.transform[3]) || 12;
    const itemX = item.transform[4];
    const itemY = item.transform[5];

    const overlapStart = Math.max(0, targetStart - range.start);
    const overlapEnd = Math.min(item.str.length, boundedEnd - range.start);
    const coversFullItem = overlapStart === 0 && overlapEnd === item.str.length;

    let boxX: number;
    let boxWidth: number;

    if (coversFullItem) {
      boxX = itemX;
      boxWidth = item.width;
    } else {
      const charWidth = item.str.length > 0 ? item.width / item.str.length : fontSize * 0.6;
      boxX = itemX + overlapStart * charWidth;
      boxWidth = (overlapEnd - overlapStart) * charWidth;
    }

    const hPad = fontSize * 0.1;
    boxX -= hPad;
    boxWidth += hPad * 2;

    boxes.push({
      pageIndex: page.pageIndex,
      x: boxX,
      y: page.height - itemY - fontSize,
      width: boxWidth,
      height: fontSize * 1.4,
    });
  }

  return boxes.length > 0
    ? mergeBoxes(boxes)
    : findTextItemBounds(entity.text, page.textItems, page.height);
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
 * Levenshtein edit distance between two strings.
 */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) curr[j] = prev[j - 1];
      else curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Find bounding boxes for an entity's text within OCR word results.
 * OCR words have bounding boxes in PDF points (already scaled from canvas pixels).
 * Uses exact matching, containment, substring, and edit-distance near-matching.
 */
function findOCRTextBounds(
  entityText: string,
  ocrWords: OCRWord[],
  occurrenceIndex?: number,
): BoundingBox[] {
  const boxes: BoundingBox[] = [];
  const entityLower = entityText.toLowerCase().trim();
  if (!entityLower || ocrWords.length === 0) return boxes;

  const wordTexts = ocrWords.map(w => w.text.trim()).filter(t => t.length > 0);
  const wordsClean = ocrWords.filter(w => w.text.trim().length > 0);
  const entityWords = entityLower.split(/\s+/).filter(w => w.length > 0);

  const addWordBoxes = (start: number, end: number) => {
    for (let k = start; k <= end; k++) {
      const w = wordsClean[k];
      boxes.push({
        pageIndex: 0,
        x: w.bbox.x0,
        y: w.bbox.y0,
        width: w.bbox.x1 - w.bbox.x0,
        height: w.bbox.y1 - w.bbox.y0,
      });
    }
  };

  const shouldUseOccurrence = (matchIndex: number) =>
    occurrenceIndex === undefined || matchIndex === occurrenceIndex;

  let matchIndex = 0;

  // 1. Exact match: concatenated OCR words === entity text
  for (let start = 0; start < wordsClean.length; start++) {
    let concat = '';
    for (let end = start; end < wordsClean.length; end++) {
      if (end > start) concat += ' ';
      concat += wordTexts[end];
      if (concat.toLowerCase() === entityLower) {
        if (shouldUseOccurrence(matchIndex)) {
          addWordBoxes(start, end);
        }
        matchIndex++;
        break;
      }
      if (concat.length > entityLower.length + 10) break;
    }
  }
  if (boxes.length > 0) return mergeBoxes(boxes);

  // 2. Single-word containment (email, SSN as one token)
  matchIndex = 0;
  for (const w of wordsClean) {
    if (w.text.toLowerCase().includes(entityLower)) {
      if (shouldUseOccurrence(matchIndex)) {
        boxes.push({ pageIndex: 0, x: w.bbox.x0, y: w.bbox.y0,
          width: w.bbox.x1 - w.bbox.x0, height: w.bbox.y1 - w.bbox.y0 });
      }
      matchIndex++;
    }
  }
  if (boxes.length > 0) return mergeBoxes(boxes);

  // 3. Near-match: compare entity words against consecutive OCR words using
  //    edit distance. Handles LLM hallucinating slightly different text
  //    (e.g., "BHUICYAN" vs OCR's "BHUIYAN").
  matchIndex = 0;
  for (let si = 0; si <= wordsClean.length - entityWords.length; si++) {
    let allMatch = true;
    let totalDist = 0;
    for (let ei = 0; ei < entityWords.length; ei++) {
      const sw = wordTexts[si + ei].toLowerCase();
      const ew = entityWords[ei];
      const dist = editDistance(sw, ew);
      const maxDist = Math.max(2, Math.ceil(ew.length * 0.3));
      if (dist > maxDist) { allMatch = false; break; }
      totalDist += dist;
    }
    if (allMatch && totalDist <= Math.max(3, Math.ceil(entityLower.length * 0.2))) {
      if (shouldUseOccurrence(matchIndex)) {
        addWordBoxes(si, si + entityWords.length - 1);
        return mergeBoxes(boxes);
      }
      matchIndex++;
    }
  }

  // 4. Substring: entity is contained within concatenated neighbors
  matchIndex = 0;
  for (let start = 0; start < wordsClean.length; start++) {
    let concat = '';
    for (let end = start; end < Math.min(start + 10, wordsClean.length); end++) {
      if (end > start) concat += ' ';
      concat += wordTexts[end];
      if (concat.toLowerCase().includes(entityLower)) {
        if (shouldUseOccurrence(matchIndex)) {
          addWordBoxes(start, end);
          return mergeBoxes(boxes);
        }
        matchIndex++;
        break;
      }
      if (concat.length > entityLower.length + 20) break;
    }
  }

  return mergeBoxes(boxes);
}

function findOCRLineBounds(
  entityText: string,
  ocrLines: OCRLine[],
  occurrenceIndex?: number,
  relativeStart?: number,
  relativeEnd?: number,
): BoundingBox[] {
  const entityLower = entityText.toLowerCase().trim();
  if (!entityLower || ocrLines.length === 0) return [];

  if (relativeStart !== undefined && relativeEnd !== undefined) {
    const targetLine = ocrLines.find((line) =>
      line.textStart !== undefined &&
      line.textEnd !== undefined &&
      relativeStart < line.textEnd &&
      relativeEnd > line.textStart
    );

    if (targetLine?.textStart !== undefined) {
      const lineLower = targetLine.text.toLowerCase();
      const localStart = Math.max(0, relativeStart - targetLine.textStart);
      let idx = lineLower.indexOf(entityLower, localStart);
      if (idx === -1) {
        idx = lineLower.indexOf(entityLower);
      }

      if (idx !== -1) {
        const lineWidth = targetLine.bbox.x1 - targetLine.bbox.x0;
        const avgCharWidth = targetLine.text.length > 0 ? lineWidth / targetLine.text.length : lineWidth;
        const hPad = Math.max(1, avgCharWidth * 0.5);
        const x = targetLine.bbox.x0 + idx * avgCharWidth - hPad;
        const width = entityText.length * avgCharWidth + hPad * 2;

        return [{
          pageIndex: 0,
          x,
          y: targetLine.bbox.y0,
          width,
          height: targetLine.bbox.y1 - targetLine.bbox.y0,
        }];
      }
    }
  }

  let matchIndex = 0;
  for (const line of ocrLines) {
    const lineLower = line.text.toLowerCase();
    let searchFrom = 0;
    while (searchFrom < lineLower.length) {
      const idx = lineLower.indexOf(entityLower, searchFrom);
      if (idx === -1) break;

      if (occurrenceIndex === undefined || matchIndex === occurrenceIndex) {
        const lineWidth = line.bbox.x1 - line.bbox.x0;
        const avgCharWidth = line.text.length > 0 ? lineWidth / line.text.length : lineWidth;
        const hPad = Math.max(1, avgCharWidth * 0.5);
        const x = line.bbox.x0 + idx * avgCharWidth - hPad;
        const width = entityText.length * avgCharWidth + hPad * 2;

        return [{
          pageIndex: 0,
          x,
          y: line.bbox.y0,
          width,
          height: line.bbox.y1 - line.bbox.y0,
        }];
      }

      matchIndex++;
      searchFrom = idx + 1;
    }
  }

  return [];
}

function getOccurrenceIndexInText(text: string, entityText: string, relativeStart: number): number | undefined {
  const haystack = text.toLowerCase();
  const needle = entityText.toLowerCase();
  if (!needle) return undefined;

  let occurrenceIndex = 0;
  let searchFrom = 0;
  while (searchFrom < haystack.length) {
    const idx = haystack.indexOf(needle, searchFrom);
    if (idx === -1) break;
    if (idx >= relativeStart) return occurrenceIndex;
    occurrenceIndex++;
    searchFrom = idx + 1;
  }

  return undefined;
}

function boxesOverlapVertically(boxes: BoundingBox[], target: BoundingBox): boolean {
  return boxes.some((box) => box.y < target.y + target.height && box.y + box.height > target.y);
}

export interface EntityOverlay {
  entityId: string;
  entity: DetectedEntity;
  boxes: BoundingBox[];
}

/**
 * Map a single entity to bounding boxes on a specific page.
 */
export function mapEntityToBoundsOnPage(
  entity: DetectedEntity,
  page: PDFPageInfo,
): BoundingBox[] {
  const boxes = findTextItemBoundsForEntity(entity, page);
  for (const box of boxes) {
    box.pageIndex = page.pageIndex;
  }
  return boxes;
}

/**
 * Map entities to per-entity overlays for a given page.
 * For scanned pages with no text items, uses OCR word bounding boxes instead.
 */
export function getPageEntityOverlays(
  entities: DetectedEntity[],
  page: PDFPageInfo,
  ocrPage?: OCRPageResult,
): EntityOverlay[] {
  const overlays: EntityOverlay[] = [];
  const isScannedPage = page.textItems.length === 0;
  const hasOCRPageOffsets = ocrPage?.textStart !== undefined && ocrPage.textEnd !== undefined;

  // For scanned pages, all entities are candidates (no text offsets to filter by)
  const pageEntities = hasOCRPageOffsets
    ? entities.filter((e) => e.start < ocrPage!.textEnd! && e.end > ocrPage!.textStart!)
    : isScannedPage
    ? entities
    : entities.filter((e) => e.start < page.textEnd && e.end > page.textStart);

  for (const entity of pageEntities) {
    let boxes: BoundingBox[];
    if (ocrPage && ocrPage.words.length > 0) {
      const occurrenceIndex = hasOCRPageOffsets
        ? getOccurrenceIndexInText(ocrPage.text, entity.text, entity.start - ocrPage.textStart!)
        : undefined;
      boxes = findOCRTextBounds(entity.text, ocrPage.words, occurrenceIndex);
      const relativeStart = hasOCRPageOffsets ? entity.start - ocrPage.textStart! : undefined;
      const relativeEnd = hasOCRPageOffsets ? entity.end - ocrPage.textStart! : undefined;
      const lineBoxes = findOCRLineBounds(entity.text, ocrPage.lines, occurrenceIndex, relativeStart, relativeEnd);
      if (lineBoxes.length > 0 && (boxes.length === 0 || !boxesOverlapVertically(boxes, lineBoxes[0]))) {
        boxes = lineBoxes;
      }
      if (boxes.length === 0 && page.textItems.length > 0) {
        boxes = findTextItemBounds(entity.text, page.textItems, page.height);
      }
      for (const box of boxes) {
        box.pageIndex = page.pageIndex;
      }
    } else {
      boxes = mapEntityToBoundsOnPage(entity, page);
    }
    if (boxes.length > 0) {
      overlays.push({ entityId: entity.id, entity, boxes });
    }
  }
  return overlays;
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
      const boxes = findTextItemBoundsForEntity(entity, page);

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
  ocrResults?: OCRPageResult[],
): Promise<Uint8Array> {
  const pageBoxes = mapEntitiesToBounds(entities, pages);
  const accepted = entities.filter(e => e.accepted);
  const totalPages = pdfDoc.numPages;
  const outputPdf = await PDFDocument.create();

  // Build OCR lookup by page index
  const ocrByPage = new Map<number, OCRPageResult>();
  if (ocrResults) {
    for (const ocrPage of ocrResults) {
      ocrByPage.set(ocrPage.pageIndex, ocrPage);
    }
  }

  for (let i = 0; i < totalPages; i++) {
    onProgress?.(i + 1, totalPages);

    let boxes = pageBoxes.get(i) || [];
    const isScannedPage = pages[i] && pages[i].textItems.length === 0;
    const ocrPage = ocrByPage.get(i);

    // For pages with OCR data, map accepted entities using OCR offsets/word boxes.
    // OCR detection text has its own offsets, so pdfjs text offsets may not line up.
    if (ocrPage && ocrPage.words.length > 0) {
      const hasOCRPageOffsets = ocrPage.textStart !== undefined && ocrPage.textEnd !== undefined;
      const ocrBoxes: BoundingBox[] = [];
      const pageAccepted = hasOCRPageOffsets
        ? accepted.filter((e) => e.start < ocrPage.textEnd! && e.end > ocrPage.textStart!)
        : accepted;

      console.log(`[LocalRedact] Page ${i + 1}: OCR has ${ocrPage.words.length} words. Mapping ${pageAccepted.length} accepted entities...`);
      for (const entity of pageAccepted) {
        const occurrenceIndex = hasOCRPageOffsets
          ? getOccurrenceIndexInText(ocrPage.text, entity.text, entity.start - ocrPage.textStart!)
          : undefined;
        let entityBoxes = findOCRTextBounds(entity.text, ocrPage.words, occurrenceIndex);
        const relativeStart = hasOCRPageOffsets ? entity.start - ocrPage.textStart! : undefined;
        const relativeEnd = hasOCRPageOffsets ? entity.end - ocrPage.textStart! : undefined;
        const lineBoxes = findOCRLineBounds(entity.text, ocrPage.lines, occurrenceIndex, relativeStart, relativeEnd);
        if (lineBoxes.length > 0 && (entityBoxes.length === 0 || !boxesOverlapVertically(entityBoxes, lineBoxes[0]))) {
          entityBoxes = lineBoxes;
        }
        if (entityBoxes.length === 0 && pages[i].textItems.length > 0) {
          entityBoxes = findTextItemBounds(entity.text, pages[i].textItems, pages[i].height);
        }
        for (const box of entityBoxes) {
          box.pageIndex = i;
          ocrBoxes.push(box);
        }
      }
      if (ocrBoxes.length > 0) {
        boxes = hasOCRPageOffsets || isScannedPage
          ? mergeBoxes(ocrBoxes)
          : mergeBoxes([...boxes, ...ocrBoxes]);
        console.log(`[LocalRedact] Page ${i + 1}: mapped ${ocrBoxes.length} OCR boxes for ${pageAccepted.length} entities.`);
      } else if (isScannedPage) {
        console.warn(`[LocalRedact] Page ${i + 1}: NO OCR boxes found for any entity. OCR words sample:`,
          ocrPage.words.slice(0, 20).map(w => w.text));
      }
    }

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

  const pdfBytes = await outputPdf.save();

  // Hex verification: scan output bytes for leaked PII strings
  const piiStrings = entities
    .filter((e) => e.accepted)
    .map((e) => e.text)
    .filter((t) => t.length >= 4); // Skip very short strings (high false-positive rate)
  const leaks = verifyNoPIIInBytes(pdfBytes, piiStrings);
  if (leaks.length > 0) {
    console.error('[LocalRedact] PII LEAK DETECTED in output PDF:', leaks);
  } else {
    console.log('[LocalRedact] Hex verification passed — zero PII strings found in output bytes.');
  }

  return pdfBytes;
}

export interface PIILeak {
  text: string;
  byteOffset: number;
}

/**
 * Scan raw PDF bytes for any occurrence of PII strings.
 * Checks both raw UTF-8 and UTF-16BE (PDF text encoding).
 * Returns an array of leaks found (empty = clean).
 */
export function verifyNoPIIInBytes(
  pdfBytes: Uint8Array,
  piiStrings: string[],
): PIILeak[] {
  const leaks: PIILeak[] = [];
  const seen = new Set<string>();

  // Deduplicate PII strings
  const unique = piiStrings.filter((s) => {
    const lower = s.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });

  // Decode PDF bytes as latin1 (preserves all byte values as chars 0-255)
  const latin1 = Array.from(pdfBytes, (b) => String.fromCharCode(b)).join('');

  for (const pii of unique) {
    // Check UTF-8 encoding (most common in modern PDFs)
    const utf8Needle = pii;
    const idx = latin1.indexOf(utf8Needle);
    if (idx !== -1) {
      leaks.push({ text: pii, byteOffset: idx });
      continue;
    }

    // Check case-insensitive (catches metadata remnants)
    const lowerHaystack = latin1.toLowerCase();
    const lowerIdx = lowerHaystack.indexOf(pii.toLowerCase());
    if (lowerIdx !== -1) {
      leaks.push({ text: pii, byteOffset: lowerIdx });
      continue;
    }

    // Check UTF-16BE encoding (PDF hex strings)
    const utf16Needle = Array.from(pii, (ch) => '\x00' + ch).join('');
    const utf16Idx = latin1.indexOf(utf16Needle);
    if (utf16Idx !== -1) {
      leaks.push({ text: pii, byteOffset: utf16Idx });
    }
  }

  return leaks;
}
