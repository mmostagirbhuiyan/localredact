import { useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

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
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ');
        pages.push(pageText);
      }

      const fullText = pages.join('\n\n');
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
