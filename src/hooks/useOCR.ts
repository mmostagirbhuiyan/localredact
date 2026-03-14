import { useState, useCallback, useRef } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface OCRWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export interface OCRPageResult {
  pageIndex: number;
  text: string;
  words: OCRWord[];
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
          }
        }
      }
    }

    return {
      pageIndex: 0,
      text: result.data.text,
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
      // produce garbage OCR without this step. We use grayscale + contrast stretch
      // rather than hard binarization to preserve text detail.
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      // First pass: find min/max luminance for contrast stretching
      let minL = 255, maxL = 0;
      for (let p = 0; p < pixels.length; p += 4) {
        const gray = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
        if (gray < minL) minL = gray;
        if (gray > maxL) maxL = gray;
      }
      const range = maxL - minL || 1;
      // Second pass: grayscale + contrast stretch
      for (let p = 0; p < pixels.length; p += 4) {
        const gray = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
        // Stretch to full 0-255 range, then apply gamma to darken text
        const stretched = ((gray - minL) / range) * 255;
        const gamma = stretched < 128 ? stretched * 0.6 : Math.min(255, stretched * 1.3);
        pixels[p] = gamma;
        pixels[p + 1] = gamma;
        pixels[p + 2] = gamma;
      }
      ctx.putImageData(imageData, 0, 0);

      console.log(`[OCR] Extracting text from page ${pageIdx + 1}...`);
      const pageResult = await ocrPage(canvas);
      pageResult.pageIndex = pageIdx;

      // Scale bounding boxes from canvas pixels back to PDF points
      for (const word of pageResult.words) {
        word.bbox.x0 /= OCR_RENDER_SCALE;
        word.bbox.y0 /= OCR_RENDER_SCALE;
        word.bbox.x1 /= OCR_RENDER_SCALE;
        word.bbox.y1 /= OCR_RENDER_SCALE;
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
