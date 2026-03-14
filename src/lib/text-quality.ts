import type { TextItem } from 'pdfjs-dist/types/src/display/api';

export interface TextQuality {
  score: number;          // 0-1, higher = better quality text extraction
  needsVision: boolean;   // true if vision fallback recommended
  reason: string | null;  // explanation when needsVision is true
}

// Threshold below which vision fallback is recommended
const QUALITY_THRESHOLD = 0.3;

/**
 * Assess the quality of pdfjs text extraction for a single page.
 * Returns a score (0-1) and whether vision fallback is recommended.
 *
 * Signals checked:
 * 1. No text items at all — scanned/image-only page
 * 2. High ratio of single-char items — letter-spacing artifacts
 * 3. Very low character density — mostly images/graphics with sparse text
 */
export function assessPageTextQuality(
  textItems: TextItem[],
  pageWidth: number,
  pageHeight: number,
): TextQuality {
  // No text at all — definitely needs vision
  if (textItems.length === 0) {
    return { score: 0, needsVision: true, reason: 'No text found — likely a scanned or image-only page' };
  }

  // Count total characters and single-char items
  let totalChars = 0;
  let singleCharItems = 0;
  let emptyItems = 0;

  for (const item of textItems) {
    const str = item.str.trim();
    totalChars += str.length;
    if (str.length === 1) singleCharItems++;
    if (str.length === 0) emptyItems++;
  }

  const nonEmptyItems = textItems.length - emptyItems;
  if (nonEmptyItems === 0 || totalChars === 0) {
    return { score: 0, needsVision: true, reason: 'No readable text content — likely a scanned page' };
  }

  // Signal 1: Single-char item ratio
  // High ratio means letter-spacing artifacts ("C O N T A C T" as separate items)
  const singleCharRatio = singleCharItems / nonEmptyItems;

  // Signal 2: Character density — chars per page area (in PDF points)
  // A typical text page (~612x792 pts) has 2000-5000 chars.
  // Very low density suggests mostly images with sparse labels.
  const pageArea = pageWidth * pageHeight;
  const charDensity = totalChars / (pageArea / 1000); // chars per 1000 sq pts

  // Score components (each 0-1, higher = better)
  // Single-char penalty: ratio > 0.6 is very bad, < 0.2 is fine
  const singleCharScore = Math.max(0, Math.min(1, 1 - (singleCharRatio - 0.2) / 0.4));

  // Density score: < 0.5 chars/1000sqpt is very sparse, > 3 is good
  const densityScore = Math.max(0, Math.min(1, (charDensity - 0.5) / 2.5));

  // Combined score (weighted)
  const score = singleCharScore * 0.6 + densityScore * 0.4;
  const needsVision = score < QUALITY_THRESHOLD;

  let reason: string | null = null;
  if (needsVision) {
    if (singleCharRatio > 0.6) {
      reason = `High single-character item ratio (${Math.round(singleCharRatio * 100)}%) — likely letter-spacing artifacts`;
    } else if (charDensity < 0.5) {
      reason = `Very low text density — page is mostly images or graphics`;
    } else {
      reason = `Poor text extraction quality (score: ${score.toFixed(2)})`;
    }
  }

  return { score: Math.round(score * 100) / 100, needsVision, reason };
}

/**
 * Assess text quality across all pages of a PDF.
 * Returns per-page results and indices of pages needing vision fallback.
 */
export function assessDocumentTextQuality(
  pages: Array<{ textItems: TextItem[]; width: number; height: number }>,
): {
  pageQualities: TextQuality[];
  pagesNeedingVision: number[];
  overallScore: number;
  needsVision: boolean;
} {
  const pageQualities = pages.map(p =>
    assessPageTextQuality(p.textItems, p.width, p.height),
  );

  const pagesNeedingVision = pageQualities
    .map((q, i) => (q.needsVision ? i : -1))
    .filter(i => i >= 0);

  const overallScore = pageQualities.length > 0
    ? pageQualities.reduce((sum, q) => sum + q.score, 0) / pageQualities.length
    : 0;

  return {
    pageQualities,
    pagesNeedingVision,
    overallScore: Math.round(overallScore * 100) / 100,
    needsVision: pagesNeedingVision.length > 0,
  };
}
