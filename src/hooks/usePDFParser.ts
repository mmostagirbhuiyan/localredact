import { useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

// Use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

interface PDFParserState {
  text: string | null;
  loading: boolean;
  error: string | null;
  fileName: string | null;
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
  });

  const parseFile = useCallback(async (file: File) => {
    setState({ text: null, loading: true, error: null, fileName: file.name });

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages: string[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent({ disableNormalization: true });
        const textItems = content.items.filter(
          (item): item is TextItem => 'str' in item,
        );
        pages.push(extractPageText(textItems));
      }

      const fullText = normalizeSpacing(pages.join('\n\n'));
      setState({ text: fullText, loading: false, error: null, fileName: file.name });
    } catch (err) {
      setState({
        text: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to parse PDF',
        fileName: file.name,
      });
    }
  }, []);

  const setText = useCallback((text: string) => {
    setState({ text, loading: false, error: null, fileName: null });
  }, []);

  const reset = useCallback(() => {
    setState({ text: null, loading: false, error: null, fileName: null });
  }, []);

  return { ...state, parseFile, setText, reset };
}
