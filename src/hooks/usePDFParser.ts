import { useState, useCallback, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { assessDocumentTextQuality, type TextQuality } from '../lib/text-quality';

// Use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

export interface PDFPageInfo {
  pageIndex: number;
  width: number;   // PDF points
  height: number;  // PDF points
  textItems: TextItem[];
  textStart: number; // char offset in fullText where this page's text begins
  textEnd: number;   // char offset in fullText where this page's text ends
}

interface PDFParserState {
  text: string | null;
  loading: boolean;
  error: string | null;
  fileName: string | null;
  pages: PDFPageInfo[];
  isPDF: boolean;
  textQuality: {
    pageQualities: TextQuality[];
    pagesNeedingVision: number[];
    overallScore: number;
    needsVision: boolean;
  } | null;
}

/**
 * Reconstruct readable text from pdfjs text content items.
 * pdfjs returns items in reading order. We use transform positions to detect
 * word gaps (items on the same line with horizontal separation) and hasEOL
 * for line breaks. This hybrid approach handles PDFs with letter-spacing
 * artifacts while preserving real word boundaries.
 */
function extractPageText(items: TextItem[]): string {
  if (items.length === 0) return '';

  let text = '';
  let prevItem: TextItem | null = null;

  for (const item of items) {
    if (prevItem && !text.endsWith('\n')) {
      const prevX = prevItem.transform[4];
      const prevY = prevItem.transform[5];
      const curX = item.transform[4];
      const curY = item.transform[5];
      const lineHeight = Math.abs(prevItem.transform[3]) || 12;

      // Check if we're on a different line (Y position changed significantly)
      if (Math.abs(curY - prevY) > lineHeight * 0.5) {
        // Don't add space — hasEOL on prevItem should have added newline.
        // If it didn't (some PDFs omit hasEOL), add one now.
        if (!text.endsWith('\n')) text += '\n';
      } else {
        // Same line — check horizontal gap
        const prevEnd = prevX + prevItem.width;
        const gap = curX - prevEnd;
        const avgCharWidth = prevItem.str.length > 0
          ? prevItem.width / prevItem.str.length
          : lineHeight * 0.5;

        // Insert space only for clear word boundaries (> 1.5x average char width).
        // This avoids inserting false spaces from letter-spacing/kerning
        // while catching true word gaps. Combined with hasEOL for line breaks
        // and pdfjs's own space chars in str, this produces clean text.
        if (gap > avgCharWidth * 1.5 && !prevItem.str.endsWith(' ') && !item.str.startsWith(' ')) {
          text += ' ';
        }
      }
    }

    text += item.str;
    if (item.hasEOL) {
      text += '\n';
    }
    prevItem = item;
  }

  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Fix spaced-out ALL-CAPS text common in PDF headers.
 * "C U S T O M E R" → "CUSTOMER", "P A G E" → "PAGE"
 */
function normalizeSpacing(text: string): string {
  return text.replace(
    /(?<![A-Za-z])([A-Z]) (?:[A-Z] ){2,}[A-Z](?![A-Za-z])/g,
    (match) => match.replace(/ /g, ''),
  );
}

export function usePDFParser() {
  const [state, setState] = useState<PDFParserState>({
    text: null,
    loading: false,
    error: null,
    fileName: null,
    pages: [],
    isPDF: false,
    textQuality: null,
  });

  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  const parseFile = useCallback(async (file: File) => {
    setState({ text: null, loading: true, error: null, fileName: file.name, pages: [], isPDF: true, textQuality: null });

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      pdfDocRef.current = pdf;

      const pageTexts: string[] = [];
      const pageInfos: PDFPageInfo[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent({ disableNormalization: true });
        const textItems = content.items.filter(
          (item): item is TextItem => 'str' in item,
        );
        pageTexts.push(extractPageText(textItems));
        pageInfos.push({
          pageIndex: i - 1,
          width: viewport.width,
          height: viewport.height,
          textItems,
          textStart: 0, // computed below
          textEnd: 0,
        });
      }

      // Compute character offsets for each page in the full text
      // Pages are joined with '\n\n', so add 2 chars between pages
      let offset = 0;
      for (let i = 0; i < pageTexts.length; i++) {
        const normalizedPageText = normalizeSpacing(pageTexts[i]);
        pageInfos[i].textStart = offset;
        pageInfos[i].textEnd = offset + normalizedPageText.length;
        offset += normalizedPageText.length + 2; // +2 for '\n\n' join
      }

      const fullText = normalizeSpacing(pageTexts.join('\n\n'));

      // Assess text extraction quality to determine if vision fallback is needed
      const textQuality = assessDocumentTextQuality(pageInfos);
      if (textQuality.needsVision) {
        console.log(
          `[PDFParser] Low text quality detected (score: ${textQuality.overallScore}).`,
          `Pages needing vision: ${textQuality.pagesNeedingVision.map(i => i + 1).join(', ')}`,
        );
        for (const idx of textQuality.pagesNeedingVision) {
          const q = textQuality.pageQualities[idx];
          console.log(`  Page ${idx + 1}: score=${q.score}, reason=${q.reason}`);
        }
      }

      setState({ text: fullText, loading: false, error: null, fileName: file.name, pages: pageInfos, isPDF: true, textQuality });
    } catch (err) {
      setState({
        text: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to parse PDF',
        fileName: file.name,
        pages: [],
        isPDF: false,
        textQuality: null,
      });
    }
  }, []);

  const setText = useCallback((text: string) => {
    pdfDocRef.current = null;
    setState({ text, loading: false, error: null, fileName: null, pages: [], isPDF: false, textQuality: null });
  }, []);

  const reset = useCallback(() => {
    pdfDocRef.current = null;
    setState({ text: null, loading: false, error: null, fileName: null, pages: [], isPDF: false, textQuality: null });
  }, []);

  /**
   * Get the pdfjs document proxy for rendering pages to canvas.
   */
  const getPDFDocument = useCallback(() => pdfDocRef.current, []);

  return { ...state, parseFile, setText, reset, getPDFDocument };
}
