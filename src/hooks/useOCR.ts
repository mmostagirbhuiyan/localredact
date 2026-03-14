import { useState, useCallback, useRef } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface OCRWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export interface OCRPageResult {
  pageIndex: number;
  text: string;           // raw OCR text (all words)
  cleanText: string;      // filtered text (high-confidence lines only, for LLM)
  words: OCRWord[];       // all words with bboxes (for coordinate mapping)
}

interface OCRState {
  loading: boolean;
  ready: boolean;
  progress: number;
  error: string | null;
}

// Scale for rendering PDF pages to canvas for OCR input.
// High scale (4x) improves accuracy on scanned documents with complex backgrounds
// (watermarks, holograms, gradients) where Tesseract struggles at lower resolutions.
const OCR_RENDER_SCALE = 4;

export function useOCR() {
  const [state, setState] = useState<OCRState>({
    loading: false,
    ready: false,
    progress: 0,
    error: null,
  });

  const workerRef = useRef<import('tesseract.js').Worker | null>(null);
  const [extractionProgress, setExtractionProgress] = useState<{ current: number; total: number } | null>(null);

  const loadWorker = useCallback(async () => {
    if (workerRef.current) {
      setState(prev => ({ ...prev, ready: true }));
      return;
    }
    if (state.loading) return;

    setState({ loading: true, ready: false, progress: 0, error: null });

    try {
      const Tesseract = await import('tesseract.js');
      const worker = await Tesseract.createWorker('eng', undefined, {
        logger: (info: { status: string; progress: number }) => {
          if (info.status === 'recognizing text') {
            setState(prev => ({ ...prev, progress: Math.round(info.progress * 100) }));
          }
        },
      });
      // Set parameters for better accuracy on scanned documents
      await worker.setParameters({
        user_defined_dpi: '300',
      });
      workerRef.current = worker;
      setState({ loading: false, ready: true, progress: 100, error: null });
    } catch (err) {
      setState({
        loading: false,
        ready: false,
        progress: 0,
        error: err instanceof Error ? err.message : 'Failed to load OCR engine',
      });
    }
  }, [state.loading]);

  const ocrPage = useCallback(async (canvas: HTMLCanvasElement): Promise<OCRPageResult> => {
    const worker = workerRef.current;
    if (!worker) throw new Error('OCR worker not loaded');

    // Pass { blocks: true } as output format — tesseract.js v7 defaults blocks to false,
    // which means blocks/paragraphs/lines/words are all null without this flag.
    const result = await worker.recognize(canvas, {}, { blocks: true });

    const words: OCRWord[] = [];
    const cleanLines: string[] = [];

    if (result.data.blocks) {
      for (const block of result.data.blocks) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            for (const w of line.words) {
              words.push({
                text: w.text,
                bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
                confidence: w.confidence / 100,
              });
            }
            // Only include lines where the average word confidence is decent.
            // Low-confidence lines are watermarks, holograms, background noise.
            if (line.words.length > 0) {
              const avgConf = line.words.reduce((s, w) => s + w.confidence, 0) / line.words.length;
              if (avgConf >= 50) {
                cleanLines.push(line.text.trim());
              }
            }
          }
        }
      }
    }

    const cleanText = cleanLines.filter(l => l.length > 0).join('\n');

    return {
      pageIndex: 0,
      text: result.data.text,
      cleanText,
      words,
    };
  }, []);

  const ocrPDFPages = useCallback(async (
    pdfDoc: PDFDocumentProxy,
    pageIndices: number[],
  ): Promise<{ pages: OCRPageResult[]; fullText: string }> => {
    const results: OCRPageResult[] = [];
    setExtractionProgress({ current: 0, total: pageIndices.length });

    for (let i = 0; i < pageIndices.length; i++) {
      const pageIdx = pageIndices[i];
      setExtractionProgress({ current: i + 1, total: pageIndices.length });

      const page = await pdfDoc.getPage(pageIdx + 1); // pdfjs is 1-indexed
      const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;

      await page.render({ canvasContext: ctx, viewport }).promise;

      // Preprocess: convert to grayscale with contrast enhancement.
      // Scanned documents with watermarks, holograms, or gradient backgrounds
      // produce garbage OCR without this step.
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      let minL = 255, maxL = 0;
      for (let p = 0; p < pixels.length; p += 4) {
        const gray = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
        if (gray < minL) minL = gray;
        if (gray > maxL) maxL = gray;
      }
      const range = maxL - minL || 1;
      for (let p = 0; p < pixels.length; p += 4) {
        const gray = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
        const stretched = ((gray - minL) / range) * 255;
        const gamma = stretched < 128 ? stretched * 0.6 : Math.min(255, stretched * 1.3);
        pixels[p] = gamma;
        pixels[p + 1] = gamma;
        pixels[p + 2] = gamma;
      }
      ctx.putImageData(imageData, 0, 0);

      console.log(`[OCR] Extracting text from page ${pageIdx + 1}...`);

      // First pass: OCR the page as-is
      let pageResult = await ocrPage(canvas);
      let rotationUsed: 'none' | 'cw' | 'ccw' = 'none';

      // Check if OCR confidence is very low — may indicate rotated content.
      // Scanned certificates are often portrait PDFs with content rotated 90
      // degrees within the page. Tesseract reads garbage without correction.
      const avgConf = (words: OCRWord[]) =>
        words.length > 0 ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0;
      const initialConf = avgConf(pageResult.words);

      if (initialConf < 0.5 && pageResult.words.length > 10) {
        console.log(`[OCR] Page ${pageIdx + 1}: low confidence (${(initialConf * 100).toFixed(1)}%), trying rotations...`);

        const makeRotated = (clockwise: boolean): HTMLCanvasElement => {
          const r = document.createElement('canvas');
          r.width = canvas.height;
          r.height = canvas.width;
          const rc = r.getContext('2d')!;
          if (clockwise) {
            rc.translate(r.width, 0);
            rc.rotate(Math.PI / 2);
          } else {
            rc.translate(0, r.height);
            rc.rotate(-Math.PI / 2);
          }
          rc.drawImage(canvas, 0, 0);
          return r;
        };

        const cwCanvas = makeRotated(true);
        const ccwCanvas = makeRotated(false);
        const cwResult = await ocrPage(cwCanvas);
        const ccwResult = await ocrPage(ccwCanvas);
        const cwConf = avgConf(cwResult.words);
        const ccwConf = avgConf(ccwResult.words);

        console.log(`[OCR] Page ${pageIdx + 1}: original=${(initialConf * 100).toFixed(1)}%, CW=${(cwConf * 100).toFixed(1)}%, CCW=${(ccwConf * 100).toFixed(1)}%`);

        if (cwConf > initialConf && cwConf >= ccwConf) {
          pageResult = cwResult;
          rotationUsed = 'cw';
        } else if (ccwConf > initialConf) {
          pageResult = ccwResult;
          rotationUsed = 'ccw';
        }
      }

      pageResult.pageIndex = pageIdx;

      // Scale bounding boxes from OCR canvas pixels back to PDF points.
      // For rotated pages, transform bboxes back to the original coordinate system.
      const cw = canvas.width;
      const ch = canvas.height;
      for (const word of pageResult.words) {
        if (rotationUsed === 'cw') {
          // CW: rotated is (ch x cw). rotated(rx,ry) → original(ry, ch - rx - rw)
          const rx0 = word.bbox.x0, ry0 = word.bbox.y0;
          const rx1 = word.bbox.x1, ry1 = word.bbox.y1;
          word.bbox.x0 = ry0 / OCR_RENDER_SCALE;
          word.bbox.y0 = (ch - rx1) / OCR_RENDER_SCALE;
          word.bbox.x1 = ry1 / OCR_RENDER_SCALE;
          word.bbox.y1 = (ch - rx0) / OCR_RENDER_SCALE;
        } else if (rotationUsed === 'ccw') {
          // CCW: rotated is (ch x cw). rotated(rx,ry) → original(cw - ry, rx)
          const rx0 = word.bbox.x0, ry0 = word.bbox.y0;
          const rx1 = word.bbox.x1, ry1 = word.bbox.y1;
          word.bbox.x0 = (cw - ry1) / OCR_RENDER_SCALE;
          word.bbox.y0 = rx0 / OCR_RENDER_SCALE;
          word.bbox.x1 = (cw - ry0) / OCR_RENDER_SCALE;
          word.bbox.y1 = rx1 / OCR_RENDER_SCALE;
        } else {
          word.bbox.x0 /= OCR_RENDER_SCALE;
          word.bbox.y0 /= OCR_RENDER_SCALE;
          word.bbox.x1 /= OCR_RENDER_SCALE;
          word.bbox.y1 /= OCR_RENDER_SCALE;
        }
      }

      console.log(`[OCR] Page ${pageIdx + 1}: ${pageResult.words.length} words, ${pageResult.text.length} chars`);
      results.push(pageResult);
    }

    setExtractionProgress(null);

    const fullText = results.map(r => r.text).join('\n\n');
    return { pages: results, fullText };
  }, [ocrPage]);

  return { ...state, loadWorker, ocrPage, ocrPDFPages, extractionProgress };
}
