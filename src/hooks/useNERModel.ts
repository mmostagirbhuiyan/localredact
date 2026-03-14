import { useState, useCallback, useRef, useEffect } from 'react';
import { DetectedEntity, EntityCategory, createEntityId } from '../lib/entity-types';
import { PII_SYSTEM_PROMPT, buildPIIUserPrompt } from '../lib/pii-prompt';

interface WebLLMEngine {
  chat: {
    completions: {
      create: (params: {
        messages: Array<{ role: string; content: string }>;
        stream: boolean;
        temperature: number;
        max_tokens: number;
      }) => AsyncIterable<{
        choices: Array<{ delta?: { content?: string } }>;
      }>;
    };
  };
  resetChat: (keepStats?: boolean) => Promise<void>;
  unload: () => void;
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

export const MODEL_ID = 'Qwen3-4B-q4f16_1-MLC';

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
    case 'ADDRESS': return 'LOCATION';
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

  return positions;
}

export function useNERModel() {
  const [state, setState] = useState<NERModelState>({
    loading: false,
    ready: false,
    progress: 0,
    error: null,
  });

  const engineRef = useRef<WebLLMEngine | null>(null);
  const supportedRef = useRef<boolean | null>(null);
  const [debugLog, setDebugLog] = useState<LLMDebugEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const detectingRef = useRef(false);
  const [inferenceProgress, setInferenceProgress] = useState<{ current: number; total: number } | null>(null);

  // Check support on mount — block all mobile devices (model is ~2.5GB, needs desktop GPU)
  useEffect(() => {
    const hasWebGPU = checkWebGPUSupport();
    const isIOS = detectIOSDevice();
    const isMobile = detectMobile();
    supportedRef.current = hasWebGPU && !isMobile;

    if (isIOS) {
      setState(prev => ({ ...prev, error: 'AI detection is not available on iPhone/iPad. Safari\'s WebGPU has known issues that cause crashes. Use a desktop browser instead.' }));
    } else if (isMobile) {
      setState(prev => ({ ...prev, error: 'AI detection requires a desktop browser. The model is too large (~2.5GB) for mobile devices.' }));
    } else if (!hasWebGPU) {
      setState(prev => ({ ...prev, error: 'WebGPU not available. AI detection requires Chrome 113+, Edge 113+, or Safari 17+.' }));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (engineRef.current) {
        try { engineRef.current.unload(); } catch { /* ignore */ }
        engineRef.current = null;
      }
    };
  }, []);

  const loadModel = useCallback(async () => {
    if (supportedRef.current === false) return;

    // If engine already loaded and ready, just signal ready
    if (engineRef.current && !state.loading) {
      setState(prev => ({ ...prev, ready: true }));
      return;
    }
    if (state.loading) return;

    setState({ loading: true, ready: false, progress: 0, error: null });

    try {
      const webllm = await import('@mlc-ai/web-llm');

      const engine = await webllm.CreateMLCEngine(MODEL_ID, {
        initProgressCallback: (report: { progress?: number; text?: string }) => {
          console.log('[WebLLM] Progress:', JSON.stringify(report));
          if (report.progress !== undefined) {
            setState(prev => ({ ...prev, progress: Math.round(report.progress! * 100) }));
          }
        },
      });

      engineRef.current = engine as unknown as WebLLMEngine;
      setState({ loading: false, ready: true, progress: 100, error: null });
    } catch (err) {
      setState({
        loading: false,
        ready: false,
        progress: 0,
        error: err instanceof Error ? err.message : 'Failed to load AI model',
      });
    }
  }, [state.loading]);

  const detect = useCallback(async (text: string): Promise<DetectedEntity[]> => {
    if (!engineRef.current) return [];

    // Cancel any in-progress detection — the old run will see this and bail out
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    // If engine is mid-inference, we can't safely interrupt the WebGPU stream.
    // Wait for it to finish its current chunk, then proceed.
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
      // Give the engine a moment to settle after the previous run
      await new Promise(r => setTimeout(r, 200));
    }

    const abort = new AbortController();
    abortRef.current = abort;
    detectingRef.current = true;

    setDebugLog([]);
    setInferenceProgress(null);

    try {
      // Reset engine chat before starting new detection
      await engineRef.current.resetChat(true);

      // Chunk text for LLM processing with overlap to catch boundary entities.
      const maxChunkSize = 1500;
      const overlapSize = 200; // chars of overlap between chunks
      const chunks: { text: string; offset: number }[] = [];
      let pos = 0;

      while (pos < text.length) {
        if (pos + maxChunkSize >= text.length) {
          chunks.push({ text: text.slice(pos), offset: pos });
          break;
        }
        const window = text.slice(pos, pos + maxChunkSize);
        let breakAt = -1;
        // Find last paragraph or sentence break
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
        // Step forward minus overlap so next chunk re-scans the tail
        pos += Math.max(end - overlapSize, Math.floor(end / 2));
      }

      const allEntities: DetectedEntity[] = [];
      const existingRanges = new Set<string>();

      for (let ci = 0; ci < chunks.length; ci++) {
        // Check if this detection was aborted (new document loaded)
        if (abort.signal.aborted) {
          console.log('[LLM] Detection aborted at chunk', ci);
          return [];
        }

        setInferenceProgress({ current: ci + 1, total: chunks.length });

        const chunk = chunks[ci];
        // Reset chat history to prevent context bleed between chunks
        await engineRef.current.resetChat(true);

        let response = '';
        const completion = await engineRef.current.chat.completions.create({
          messages: [
            { role: 'system', content: PII_SYSTEM_PROMPT },
            { role: 'user', content: buildPIIUserPrompt(chunk.text) },
          ],
          stream: true,
          temperature: 0,
          max_tokens: 1024,
        });

        for await (const part of completion) {
          if (abort.signal.aborted) break;
          const delta = part.choices[0]?.delta?.content || '';
          if (delta) response += delta;
        }

        // Check abort after streaming completes
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

          // Find all positions of this entity in the full source text
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
  }, []);

  return { ...state, loadModel, detect, debugLog, inferenceProgress };
}
