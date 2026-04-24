import { useState, useCallback, useRef, useEffect } from 'react';
import { DetectedEntity, EntityCategory, createEntityId } from '../lib/entity-types';
import { PII_SYSTEM_PROMPT, buildPIIUserPrompt } from '../lib/pii-prompt';

interface BonsaiWorkerMessage {
  status: 'loading' | 'ready' | 'token' | 'complete' | 'error';
  progress?: number;
  token?: string;
  output?: string;
  tps?: number;
  numTokens?: number;
  data?: string;
}

export interface LLMDebugEntry {
  chunkIndex: number;
  totalChunks: number;
  systemPrompt: string;
  userPrompt: string;
  rawResponse: string;
  parsedEntities: PIIEntity[];
  timestamp: number;
}

export interface LLMTimingData {
  totalMs: number;
  chunkTimesMs: number[];
  chunkCount: number;
}

interface NERModelState {
  loading: boolean;
  ready: boolean;
  progress: number;
  error: string | null;
}

interface PIIEntity {
  type: string;
  text: string;
  confidence?: number;
}

export const MODEL_ID = 'onnx-community/Bonsai-8B-ONNX';
export const BONSAI_MODEL_KEY = '8b';

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

function mapLLMType(type: string): EntityCategory | null {
  const normalized = type.toUpperCase().trim();
  switch (normalized) {
    case 'PERSON': return 'PERSON';
    case 'ORGANIZATION': return 'ORGANIZATION';
    case 'LOCATION': return 'LOCATION';
    case 'ADDRESS': return 'ADDRESS';
    case 'STREET_ADDRESS': return 'ADDRESS';
    case 'MAILING_ADDRESS': return 'ADDRESS';
    case 'DATE': return 'DATE';
    case 'ACCOUNT_NUMBER': return 'SSN';
    case 'USERNAME': return 'PERSON';
    case 'PASSWORD': return 'SSN';
    case 'ID_NUMBER': return 'SSN';
    case 'SSN': return 'SSN';
    case 'CREDIT_CARD': return 'CREDIT_CARD';
    case 'EMAIL': return 'EMAIL';
    case 'EMAIL_ADDRESS': return 'EMAIL';
    case 'PHONE': return 'PHONE';
    case 'PHONE_NUMBER': return 'PHONE';
    default: return null;
  }
}

/**
 * Parse LLM response into PII entities. Handles JSON wrapped in markdown
 * code blocks, partial JSON, and other common LLM output quirks.
 */
function parseLLMResponse(response: string): PIIEntity[] {
  let cleaned = response.trim();

  // Strip Qwen3 thinking blocks: <think>...</think>
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
  cleaned = cleaned.trim();

  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  // Find the JSON array in the response
  const arrStart = cleaned.indexOf('[');
  const arrEnd = cleaned.lastIndexOf(']');
  if (arrStart === -1 || arrEnd === -1 || arrEnd <= arrStart) return [];

  let jsonStr = cleaned.slice(arrStart, arrEnd + 1);

  // Fix trailing commas before ] (common LLM output quirk)
  jsonStr = jsonStr.replace(/,\s*]/g, ']');

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item: unknown): item is PIIEntity =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as PIIEntity).type === 'string' &&
        typeof (item as PIIEntity).text === 'string' &&
        (item as PIIEntity).text.length > 1,
    );
  } catch {
    return [];
  }
}

/**
 * Normalize whitespace for comparison: collapse runs of spaces/newlines into single space.
 */
function normalizeWS(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Levenshtein edit distance between two strings.
 * Counts minimum insertions, deletions, and substitutions needed.
 */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Use single-row optimization for memory efficiency
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Find all occurrences of entity text in source, with fuzzy whitespace matching.
 * PDF text extraction often produces different spacing than what the LLM sees,
 * so we normalize whitespace for comparison but return the actual source positions.
 */
function findEntityPositions(
  entityText: string,
  sourceText: string,
  existingRanges: Set<string>,
): { start: number; end: number; matchType: 'exact' | 'fuzzy' }[] {
  const positions: { start: number; end: number; matchType: 'exact' | 'fuzzy' }[] = [];
  const normalizedEntity = normalizeWS(entityText);
  if (!normalizedEntity) return positions;

  // First try exact match (fast path)
  let searchFrom = 0;
  while (searchFrom < sourceText.length) {
    const idx = sourceText.indexOf(entityText, searchFrom);
    if (idx === -1) break;

    const rangeKey = `${idx}-${idx + entityText.length}`;
    if (!existingRanges.has(rangeKey)) {
      positions.push({ start: idx, end: idx + entityText.length, matchType: 'exact' });
    }
    searchFrom = idx + 1;
  }

  if (positions.length > 0) return positions;

  // Fuzzy match: case-insensitive with normalized whitespace.
  // Slide a window through the source text looking for spans whose
  // normalized form matches the normalized entity.
  const sourceLower = sourceText.toLowerCase();
  const entityWords = normalizedEntity.split(' ');
  const firstWord = entityWords[0];

  searchFrom = 0;
  while (searchFrom < sourceLower.length) {
    const idx = sourceLower.indexOf(firstWord, searchFrom);
    if (idx === -1) break;

    // Try to match the full entity starting from here, allowing flexible whitespace
    let si = idx;
    let matched = true;
    for (const word of entityWords) {
      // Skip whitespace in source
      while (si < sourceText.length && /\s/.test(sourceText[si])) si++;
      // Check if word matches at current position
      const srcSlice = sourceLower.slice(si, si + word.length);
      if (srcSlice !== word) {
        matched = false;
        break;
      }
      si += word.length;
    }

    if (matched) {
      const rangeKey = `${idx}-${si}`;
      if (!existingRanges.has(rangeKey)) {
        positions.push({ start: idx, end: si, matchType: 'fuzzy' });
      }
    }
    searchFrom = idx + 1;
  }

  if (positions.length > 0) return positions;

  // Near-match fallback for OCR text: the LLM may return entity text with
  // 1-2 character differences from OCR source (e.g., "BHUICYAN" vs "BHUIYAN").
  // Compare entity words against consecutive source words using edit distance.
  if (normalizedEntity.length >= 4) {
    const wordRe = /\S+/g;
    const sourceWords: { text: string; start: number; end: number }[] = [];
    let wm;
    while ((wm = wordRe.exec(sourceText)) !== null) {
      sourceWords.push({ text: wm[0], start: wm.index, end: wm.index + wm[0].length });
    }

    const entityWordList = normalizedEntity.split(' ');
    for (let si = 0; si <= sourceWords.length - entityWordList.length; si++) {
      let totalDiffs = 0;
      let allMatched = true;
      for (let ei = 0; ei < entityWordList.length; ei++) {
        const sw = sourceWords[si + ei].text.toLowerCase();
        const ew = entityWordList[ei];
        const diffs = editDistance(sw, ew);
        const maxWordDiffs = Math.max(2, Math.ceil(ew.length * 0.25));
        if (diffs > maxWordDiffs) {
          allMatched = false;
          break;
        }
        totalDiffs += diffs;
      }

      if (allMatched && totalDiffs > 0) {
        const matchStart = sourceWords[si].start;
        const matchEnd = sourceWords[si + entityWordList.length - 1].end;
        const rangeKey = `${matchStart}-${matchEnd}`;
        if (!existingRanges.has(rangeKey)) {
          positions.push({ start: matchStart, end: matchEnd, matchType: 'fuzzy' });
          return positions;
        }
      }
    }
  }

  return positions;
}

export function useNERModel() {
  const [state, setState] = useState<NERModelState>({
    loading: false,
    ready: false,
    progress: 0,
    error: null,
  });

  const workerRef = useRef<Worker | null>(null);
  const supportedRef = useRef<boolean | null>(null);
  const [debugLog, setDebugLog] = useState<LLMDebugEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const detectingRef = useRef(false);
  const [inferenceProgress, setInferenceProgress] = useState<{ current: number; total: number } | null>(null);
  const [timing, setTiming] = useState<LLMTimingData | null>(null);

  useEffect(() => {
    const hasWebGPU = checkWebGPUSupport();
    const isIOS = detectIOSDevice();
    const isMobile = detectMobile();
    supportedRef.current = hasWebGPU && !isMobile;

    if (isIOS) {
      setState(prev => ({ ...prev, error: 'AI detection is not available on iPhone/iPad. Safari\'s WebGPU has known issues that cause crashes. Use a desktop browser instead.' }));
    } else if (isMobile) {
      setState(prev => ({ ...prev, error: 'AI detection requires a desktop browser. The model needs ~1.2GB download and a WebGPU-capable GPU.' }));
    } else if (!hasWebGPU) {
      setState(prev => ({ ...prev, error: 'WebGPU not available. AI detection requires Chrome 113+, Edge 113+, or Safari 17+.' }));
    }
  }, []);

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const loadModel = useCallback(async () => {
    if (supportedRef.current === false) return;

    if (workerRef.current && !state.loading) {
      setState(prev => ({ ...prev, ready: true }));
      return;
    }
    if (state.loading) return;

    setState({ loading: true, ready: false, progress: 0, error: null });

    try {
      const worker = new Worker(
        new URL('../workers/bonsai-worker.js', import.meta.url),
        { type: 'module' },
      );

      worker.onmessage = (e: MessageEvent<BonsaiWorkerMessage>) => {
        const { status, progress } = e.data;
        if (status === 'loading') {
          console.log('[Bonsai] Loading:', progress);
          setState(prev => ({ ...prev, progress: Math.round(progress ?? 0) }));
        } else if (status === 'ready') {
          console.log('[Bonsai] Model ready');
          setState({ loading: false, ready: true, progress: 100, error: null });
        } else if (status === 'error') {
          setState({
            loading: false,
            ready: false,
            progress: 0,
            error: e.data.data || 'Failed to load AI model',
          });
        }
      };

      workerRef.current = worker;
      worker.postMessage({ type: 'load', data: BONSAI_MODEL_KEY });
    } catch (err) {
      setState({
        loading: false,
        ready: false,
        progress: 0,
        error: err instanceof Error ? err.message : 'Failed to load AI model',
      });
    }
  }, [state.loading]);

  const generateWithWorker = useCallback((
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> => {
    return new Promise((resolve, reject) => {
      const worker = workerRef.current;
      if (!worker) { reject(new Error('Worker not loaded')); return; }

      let response = '';
      const handler = (e: MessageEvent<BonsaiWorkerMessage>) => {
        if (e.data.status === 'token') {
          response += e.data.token ?? '';
        } else if (e.data.status === 'complete') {
          worker.removeEventListener('message', handler);
          resolve(e.data.output ?? response);
        } else if (e.data.status === 'error') {
          worker.removeEventListener('message', handler);
          reject(new Error(e.data.data ?? 'Generation failed'));
        }
      };
      worker.addEventListener('message', handler);
      worker.postMessage({ type: 'generate', data: { messages, max_tokens: 1024, temperature: 0 } });
    });
  }, []);

  const detect = useCallback(async (text: string): Promise<DetectedEntity[]> => {
    if (!workerRef.current) return [];

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    if (detectingRef.current) {
      console.log('[LLM] Waiting for previous detection to finish...');
      const waitStart = Date.now();
      while (detectingRef.current) {
        if (Date.now() - waitStart > 30000) {
          console.warn('[LLM] Timed out waiting for previous detection. Forcing reset.');
          detectingRef.current = false;
          break;
        }
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 200));
    }

    const abort = new AbortController();
    abortRef.current = abort;
    detectingRef.current = true;

    setDebugLog([]);
    setInferenceProgress(null);
    setTiming(null);

    try {
      const maxChunkSize = 1500;
      const overlapSize = 200;
      const chunks: { text: string; offset: number }[] = [];
      let pos = 0;

      while (pos < text.length) {
        if (pos + maxChunkSize >= text.length) {
          chunks.push({ text: text.slice(pos), offset: pos });
          break;
        }
        const window = text.slice(pos, pos + maxChunkSize);
        let breakAt = -1;
        for (let i = window.length - 1; i >= Math.floor(window.length / 2); i--) {
          if (window[i] === '\n' || window[i] === '.' || window[i] === '!' || window[i] === '?') {
            breakAt = i + 1;
            break;
          }
        }
        if (breakAt === -1) {
          for (let i = window.length - 1; i >= Math.floor(window.length / 2); i--) {
            if (window[i] === ' ') { breakAt = i + 1; break; }
          }
        }
        const end = breakAt > 0 ? breakAt : maxChunkSize;
        chunks.push({ text: text.slice(pos, pos + end), offset: pos });
        pos += Math.max(end - overlapSize, Math.floor(end / 2));
      }

      const allEntities: DetectedEntity[] = [];
      const existingRanges = new Set<string>();
      const inferenceStart = performance.now();
      const chunkTimesMs: number[] = [];

      for (let ci = 0; ci < chunks.length; ci++) {
        if (abort.signal.aborted) {
          console.log('[LLM] Detection aborted at chunk', ci);
          return [];
        }

        setInferenceProgress({ current: ci + 1, total: chunks.length });

        const chunk = chunks[ci];
        workerRef.current.postMessage({ type: 'reset' });

        const chunkStart = performance.now();
        const messages = [
          { role: 'system', content: PII_SYSTEM_PROMPT },
          { role: 'user', content: buildPIIUserPrompt(chunk.text) },
        ];

        const response = await generateWithWorker(messages);
        chunkTimesMs.push(performance.now() - chunkStart);

        if (abort.signal.aborted) {
          console.log('[LLM] Detection aborted during chunk', ci);
          return [];
        }

        console.log('[LLM] Raw response:', response);
        const piiEntities = parseLLMResponse(response);
        console.log('[LLM] Parsed entities:', JSON.stringify(piiEntities));

        const userPrompt = buildPIIUserPrompt(chunk.text);
        setDebugLog(prev => [...prev, {
          chunkIndex: ci,
          totalChunks: chunks.length,
          systemPrompt: PII_SYSTEM_PROMPT,
          userPrompt,
          rawResponse: response,
          parsedEntities: piiEntities,
          timestamp: Date.now(),
        }]);

        for (const entity of piiEntities) {
          const category = mapLLMType(entity.type);
          if (!category) {
            console.warn('[LLM] Unknown entity type, skipping:', entity.type, entity.text);
            continue;
          }

          const positions = findEntityPositions(entity.text, text, existingRanges);

          if (positions.length === 0) {
            console.warn('[LLM] Entity not found in source text:', JSON.stringify(entity));
          }

          for (const pos of positions) {
            const rangeKey = `${pos.start}-${pos.end}`;
            existingRanges.add(rangeKey);
            allEntities.push({
              id: createEntityId(),
              text: entity.text,
              category,
              source: 'ner',
              start: pos.start,
              end: pos.end,
              accepted: true,
              confidence: pos.matchType === 'exact' ? 0.95 : 0.8,
            });
          }
        }
      }

      const totalMs = performance.now() - inferenceStart;
      setTiming({ totalMs, chunkTimesMs, chunkCount: chunks.length });
      setInferenceProgress(null);
      return allEntities.sort((a, b) => a.start - b.start);
    } catch (err) {
      if (abort.signal.aborted) {
        console.log('[LLM] Detection aborted');
        return [];
      }
      console.error('[LLM] Detection failed:', err);
      return [];
    } finally {
      detectingRef.current = false;
      setInferenceProgress(null);
    }
  }, [generateWithWorker]);

  return { ...state, loadModel, detect, debugLog, inferenceProgress, timing };
}
