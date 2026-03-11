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
}

export const MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

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

function mapLLMType(type: string): EntityCategory | null {
  const normalized = type.toUpperCase().trim();
  switch (normalized) {
    case 'PERSON': return 'PERSON';
    case 'ORGANIZATION': return 'ORGANIZATION';
    case 'LOCATION': return 'LOCATION';
    case 'ADDRESS': return 'LOCATION';
    case 'DATE': return 'DATE';
    case 'USERNAME': return 'PERSON';
    case 'PASSWORD': return 'SSN';
    case 'ID_NUMBER': return 'SSN';
    default: return null;
  }
}

/**
 * Parse LLM response into PII entities. Handles JSON wrapped in markdown
 * code blocks, partial JSON, and other common LLM output quirks.
 */
function parseLLMResponse(response: string): PIIEntity[] {
  let cleaned = response.trim();

  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  // Find the JSON array in the response
  const arrStart = cleaned.indexOf('[');
  const arrEnd = cleaned.lastIndexOf(']');
  if (arrStart === -1 || arrEnd === -1 || arrEnd <= arrStart) return [];

  const jsonStr = cleaned.slice(arrStart, arrEnd + 1);

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
 * Find all occurrences of an entity text in the source and return char offsets.
 */
function findEntityPositions(
  entityText: string,
  sourceText: string,
  existingRanges: Set<string>,
): { start: number; end: number }[] {
  const positions: { start: number; end: number }[] = [];
  let searchFrom = 0;

  while (searchFrom < sourceText.length) {
    const idx = sourceText.indexOf(entityText, searchFrom);
    if (idx === -1) break;

    const rangeKey = `${idx}-${idx + entityText.length}`;
    if (!existingRanges.has(rangeKey)) {
      positions.push({ start: idx, end: idx + entityText.length });
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

  // Check support on mount
  useEffect(() => {
    const hasWebGPU = checkWebGPUSupport();
    const isIOS = detectIOSDevice();
    supportedRef.current = hasWebGPU && !isIOS;

    if (!hasWebGPU) {
      setState(prev => ({ ...prev, error: 'WebGPU not available. AI detection requires Chrome 113+, Edge 113+, or Safari 17+.' }));
    } else if (isIOS) {
      setState(prev => ({ ...prev, error: 'AI detection not available on iOS due to WebGPU limitations.' }));
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
    if (engineRef.current || state.loading) return;
    if (supportedRef.current === false) return;

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

    setDebugLog([]);

    try {
      // Chunk text for LLM processing. LLM context is much larger than
      // token classifiers, so we can use bigger chunks.
      const maxChunkSize = 1500;
      const chunks: string[] = [];
      let pos = 0;

      while (pos < text.length) {
        if (pos + maxChunkSize >= text.length) {
          chunks.push(text.slice(pos));
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
        chunks.push(text.slice(pos, pos + end));
        pos += end;
      }

      const allEntities: DetectedEntity[] = [];
      const existingRanges = new Set<string>();

      for (const chunk of chunks) {
        // Reset chat history to prevent context bleed between chunks
        await engineRef.current.resetChat(true);

        let response = '';
        const completion = await engineRef.current.chat.completions.create({
          messages: [
            { role: 'system', content: PII_SYSTEM_PROMPT },
            { role: 'user', content: buildPIIUserPrompt(chunk) },
          ],
          stream: true,
          temperature: 0.1,
          max_tokens: 1024,
        });

        for await (const part of completion) {
          const delta = part.choices[0]?.delta?.content || '';
          if (delta) response += delta;
        }

        console.log('[LLM] Raw response:', response);
        const piiEntities = parseLLMResponse(response);
        console.log('[LLM] Parsed entities:', JSON.stringify(piiEntities));

        const userPrompt = buildPIIUserPrompt(chunk);
        setDebugLog(prev => [...prev, {
          chunkIndex: chunks.indexOf(chunk),
          totalChunks: chunks.length,
          systemPrompt: PII_SYSTEM_PROMPT,
          userPrompt,
          rawResponse: response,
          parsedEntities: piiEntities,
          timestamp: Date.now(),
        }]);

        for (const entity of piiEntities) {
          const category = mapLLMType(entity.type);
          if (!category) continue;

          // Find all positions of this entity in the full source text
          const positions = findEntityPositions(entity.text, text, existingRanges);

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
            });
          }
        }
      }

      return allEntities.sort((a, b) => a.start - b.start);
    } catch {
      return [];
    }
  }, []);

  return { ...state, loadModel, detect, debugLog };
}
