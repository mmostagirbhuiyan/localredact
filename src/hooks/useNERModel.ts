import { useState, useCallback, useRef } from 'react';
import { DetectedEntity, EntityCategory, createEntityId } from '../lib/entity-types';

interface NERResult {
  entity: string;
  score: number;
  index: number;
  word: string;
  start?: number;
  end?: number;
}

interface NERModelState {
  loading: boolean;
  ready: boolean;
  progress: number;
  error: string | null;
}

type NERPipeline = (text: string) => Promise<NERResult[]>;

function mapNERLabel(label: string): EntityCategory | null {
  // BERT NER labels: B-PER, I-PER, B-ORG, I-ORG, B-LOC, I-LOC, B-MISC, I-MISC
  if (label.includes('PER')) return 'PERSON';
  if (label.includes('ORG')) return 'ORGANIZATION';
  if (label.includes('LOC')) return 'LOCATION';
  return null; // Skip MISC
}

function reconstructTokenText(words: string[]): string {
  let text = '';
  for (const w of words) {
    if (w.startsWith('##')) {
      text += w.slice(2);
    } else {
      text += (text ? ' ' : '') + w;
    }
  }
  return text;
}

function mergeTokenSpans(results: NERResult[], sourceText: string): { text: string; category: EntityCategory; start: number; end: number }[] {
  const groups: { words: string[]; category: EntityCategory }[] = [];
  let current: { words: string[]; category: EntityCategory } | null = null;

  for (const r of results) {
    const category = mapNERLabel(r.entity);
    if (!category) {
      if (current) {
        groups.push(current);
        current = null;
      }
      continue;
    }

    const isBeginning = r.entity.startsWith('B-');
    const isContinuation = r.entity.startsWith('I-');

    if (isBeginning || !current || (isContinuation && current.category !== category)) {
      if (current) groups.push(current);
      current = { words: [r.word], category };
    } else {
      current.words.push(r.word);
    }
  }
  if (current) groups.push(current);

  // Reconstruct text from tokens and find positions in source
  const merged: { text: string; category: EntityCategory; start: number; end: number }[] = [];
  let searchFrom = 0;

  for (const g of groups) {
    const entityText = reconstructTokenText(g.words);
    const idx = sourceText.indexOf(entityText, searchFrom);
    if (idx !== -1) {
      merged.push({ text: entityText, category: g.category, start: idx, end: idx + entityText.length });
      searchFrom = idx + entityText.length;
    } else {
      // Fuzzy fallback: search case-insensitively
      const lower = sourceText.toLowerCase();
      const idxLower = lower.indexOf(entityText.toLowerCase(), searchFrom);
      if (idxLower !== -1) {
        merged.push({
          text: sourceText.slice(idxLower, idxLower + entityText.length),
          category: g.category,
          start: idxLower,
          end: idxLower + entityText.length,
        });
        searchFrom = idxLower + entityText.length;
      }
    }
  }

  return merged;
}

export function useNERModel() {
  const [state, setState] = useState<NERModelState>({
    loading: false,
    ready: false,
    progress: 0,
    error: null,
  });

  const pipelineRef = useRef<NERPipeline | null>(null);

  const loadModel = useCallback(async () => {
    if (pipelineRef.current || state.loading) return;

    setState({ loading: true, ready: false, progress: 0, error: null });

    try {
      const { pipeline, env } = await import('@huggingface/transformers');

      // Disable local model loading — fetch directly from HuggingFace CDN.
      // Without this, the browser tries /models/... which hits the SPA fallback.
      env.allowLocalModels = false;

      const ner = await pipeline('token-classification', 'Xenova/bert-base-NER', {
        progress_callback: (data: Record<string, unknown>) => {
          if ('progress' in data && typeof data.progress === 'number') {
            setState((prev) => ({ ...prev, progress: Math.round(data.progress as number) }));
          }
        },
      });

      pipelineRef.current = ner as unknown as NERPipeline;
      setState({ loading: false, ready: true, progress: 100, error: null });
    } catch (err) {
      setState({
        loading: false,
        ready: false,
        progress: 0,
        error: err instanceof Error ? err.message : 'Failed to load NER model',
      });
    }
  }, [state.loading]);

  const detect = useCallback(async (text: string): Promise<DetectedEntity[]> => {
    if (!pipelineRef.current) return [];

    try {
      // Split on sentence boundaries to avoid cutting through words/entities
      const maxChunkSize = 512;
      const chunks: { text: string; offset: number }[] = [];
      let pos = 0;

      while (pos < text.length) {
        if (pos + maxChunkSize >= text.length) {
          chunks.push({ text: text.slice(pos), offset: pos });
          break;
        }
        // Find the last sentence-ending punctuation or newline within the limit
        const window = text.slice(pos, pos + maxChunkSize);
        let breakAt = -1;
        for (let i = window.length - 1; i >= Math.floor(window.length / 2); i--) {
          if (window[i] === '.' || window[i] === '\n' || window[i] === '!' || window[i] === '?') {
            breakAt = i + 1;
            break;
          }
        }
        // Fall back to last space if no sentence boundary found
        if (breakAt === -1) {
          for (let i = window.length - 1; i >= Math.floor(window.length / 2); i--) {
            if (window[i] === ' ') {
              breakAt = i + 1;
              break;
            }
          }
        }
        const end = breakAt > 0 ? breakAt : maxChunkSize;
        chunks.push({ text: text.slice(pos, pos + end), offset: pos });
        pos += end;
      }

      const allEntities: DetectedEntity[] = [];

      for (const chunk of chunks) {
        const results = await pipelineRef.current(chunk.text);
        const merged = mergeTokenSpans(results, chunk.text);

        for (const m of merged) {
          allEntities.push({
            id: createEntityId(),
            text: m.text,
            category: m.category,
            source: 'ner',
            start: m.start + chunk.offset,
            end: m.end + chunk.offset,
            accepted: true,
          });
        }
      }

      return allEntities;
    } catch {
      return [];
    }
  }, []);

  return { ...state, loadModel, detect };
}
