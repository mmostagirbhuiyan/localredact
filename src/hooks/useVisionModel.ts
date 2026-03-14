import { useState, useCallback, useRef, useEffect } from 'react';

export const VISION_MODEL_ID = 'HuggingFaceTB/SmolVLM-256M-Instruct';

interface VisionModelState {
  loading: boolean;
  ready: boolean;
  progress: number;
  error: string | null;
}

function checkWebGPUSupport(): boolean {
  if (typeof navigator === 'undefined') return false;
  return !!(navigator as Navigator & { gpu?: unknown }).gpu;
}

function detectIOSDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS13Plus = ua.includes('Mac') && 'ontouchend' in document;
  return isIOS || isIPadOS13Plus;
}

function detectMobile(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth <= 768;
  return mobileUA.test(ua) || (isTouchDevice && isSmallScreen);
}

// Typed interfaces for @huggingface/transformers objects
interface HFProcessor {
  apply_chat_template: (messages: ChatMessage[], options: { add_generation_prompt: boolean }) => string;
  batch_decode: (sequences: unknown, options: { skip_special_tokens: boolean }) => string[];
  tokenizer: unknown;
  (text: string, images: HFRawImage[], options?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

interface HFModel {
  generate: (params: Record<string, unknown>) => Promise<{ sequences: unknown }>;
  dispose: () => Promise<void>;
}

interface HFRawImage {
  width: number;
  height: number;
}

interface ChatMessage {
  role: string;
  content: Array<{ type: string; text?: string; image?: HFRawImage }>;
}

// Scale for rendering PDF pages to canvas for vision input.
// Lower than RENDER_SCALE (3) in pdf-redactor since we need speed, not print quality.
const VISION_RENDER_SCALE = 1.5;

export interface VisionPageResult {
  pageIndex: number;
  text: string;
}

export function useVisionModel() {
  const [state, setState] = useState<VisionModelState>({
    loading: false,
    ready: false,
    progress: 0,
    error: null,
  });

  const processorRef = useRef<HFProcessor | null>(null);
  const modelRef = useRef<HFModel | null>(null);
  const supportedRef = useRef<boolean | null>(null);
  const [extractionProgress, setExtractionProgress] = useState<{ current: number; total: number } | null>(null);

  // Check support on mount — same mobile blocking as useNERModel
  useEffect(() => {
    const hasWebGPU = checkWebGPUSupport();
    const isIOS = detectIOSDevice();
    const isMobile = detectMobile();
    supportedRef.current = hasWebGPU && !isMobile;

    if (isIOS) {
      setState(prev => ({ ...prev, error: 'Vision model not available on iPhone/iPad. Use a desktop browser.' }));
    } else if (isMobile) {
      setState(prev => ({ ...prev, error: 'Vision model requires a desktop browser.' }));
    } else if (!hasWebGPU) {
      setState(prev => ({ ...prev, error: 'WebGPU not available. Vision model requires Chrome 113+, Edge 113+, or Safari 17+.' }));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (modelRef.current) {
        try { modelRef.current.dispose(); } catch { /* ignore */ }
        modelRef.current = null;
      }
      processorRef.current = null;
    };
  }, []);

  const loadModel = useCallback(async () => {
    if (supportedRef.current === false) return;

    // Already loaded
    if (processorRef.current && modelRef.current && !state.loading) {
      setState(prev => ({ ...prev, ready: true }));
      return;
    }
    if (state.loading) return;

    setState({ loading: true, ready: false, progress: 0, error: null });

    try {
      const { AutoProcessor, AutoModelForVision2Seq } = await import('@huggingface/transformers');

      const progressCallback = (report: { status: string; progress?: number; file?: string }) => {
        if (report.progress !== undefined) {
          setState(prev => ({ ...prev, progress: Math.round(report.progress!) }));
        }
        console.log('[SmolVLM] Progress:', report.status, report.file ?? '', report.progress ?? '');
      };

      const [processor, model] = await Promise.all([
        AutoProcessor.from_pretrained(VISION_MODEL_ID, {
          progress_callback: progressCallback,
        }),
        AutoModelForVision2Seq.from_pretrained(VISION_MODEL_ID, {
          dtype: 'fp32',
          device: 'webgpu',
          progress_callback: progressCallback,
        }),
      ]);

      processorRef.current = processor as unknown as HFProcessor;
      modelRef.current = model as unknown as HFModel;
      setState({ loading: false, ready: true, progress: 100, error: null });
    } catch (err) {
      setState({
        loading: false,
        ready: false,
        progress: 0,
        error: err instanceof Error ? err.message : 'Failed to load vision model',
      });
    }
  }, [state.loading]);

  /**
   * Extract text from a page image using SmolVLM.
   * Takes a canvas element (rendered PDF page) and returns the extracted text.
   */
  const extractText = useCallback(async (canvas: HTMLCanvasElement): Promise<string> => {
    if (!processorRef.current || !modelRef.current) {
      throw new Error('Vision model not loaded');
    }

    const { RawImage } = await import('@huggingface/transformers');

    // Convert canvas to RawImage
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const image = new RawImage(imageData.data, canvas.width, canvas.height, 4) as unknown as HFRawImage;

    const processor = processorRef.current;
    const model = modelRef.current;

    // Build chat message with image + text extraction prompt
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'image', image },
          {
            type: 'text',
            text: 'Extract all text from this document image. Return the text exactly as it appears, preserving layout and line breaks. Do not add any commentary.',
          },
        ],
      },
    ];

    const text = processor.apply_chat_template(messages, {
      add_generation_prompt: true,
    });

    const inputs = await processor(text, [image]);

    const { sequences } = await model.generate({
      ...inputs,
      max_new_tokens: 1024,
      do_sample: false,
      repetition_penalty: 1.1,
    });

    const decoded = processor.batch_decode(sequences, {
      skip_special_tokens: true,
    });

    // The decoded output includes the prompt — extract only the generated part
    // SmolVLM chat format: the response comes after the last "Assistant:" marker
    const output = decoded[0] || '';
    const assistantMarker = output.lastIndexOf('Assistant:');
    if (assistantMarker !== -1) {
      return output.slice(assistantMarker + 'Assistant:'.length).trim();
    }
    return output.trim();
  }, []);

  /**
   * Render PDF pages to offscreen canvases and extract text via SmolVLM.
   * Processes pages sequentially (GPU constraint). Returns per-page text results
   * and combined full text suitable for feeding into the PII detection pipeline.
   */
  const extractPDFPages = useCallback(async (
    pdfDoc: { getPage: (num: number) => Promise<{ getViewport: (opts: { scale: number }) => { width: number; height: number }; render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> } }> },
    pageIndices: number[],
  ): Promise<{ pages: VisionPageResult[]; fullText: string }> => {
    const results: VisionPageResult[] = [];
    setExtractionProgress({ current: 0, total: pageIndices.length });

    for (let i = 0; i < pageIndices.length; i++) {
      const pageIdx = pageIndices[i];
      setExtractionProgress({ current: i + 1, total: pageIndices.length });

      // Render page to offscreen canvas
      const page = await pdfDoc.getPage(pageIdx + 1); // pdfjs is 1-indexed
      const viewport = page.getViewport({ scale: VISION_RENDER_SCALE });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;

      await page.render({ canvasContext: ctx, viewport }).promise;

      console.log(`[SmolVLM] Extracting text from page ${pageIdx + 1}...`);
      const pageText = await extractText(canvas);
      console.log(`[SmolVLM] Page ${pageIdx + 1} text (${pageText.length} chars):`, pageText.slice(0, 200));

      results.push({ pageIndex: pageIdx, text: pageText });
    }

    setExtractionProgress(null);

    const fullText = results.map(r => r.text).join('\n\n');
    return { pages: results, fullText };
  }, [extractText]);

  return { ...state, loadModel, extractText, extractPDFPages, extractionProgress };
}
