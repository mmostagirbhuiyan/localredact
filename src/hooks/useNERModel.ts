import { useState, useCallback, useRef } from 'react';
import { DetectedEntity, EntityCategory, createEntityId } from '../lib/entity-types';

type Pipeline = (text: string) => Promise<NERResult[]>;

interface NERResult {
  entity: string;
  score: number;
  word: string;
  start: number;
  end: number;
}

interface NERModelState {
  loading: boolean;
  ready: boolean;
  progress: number;
  error: string | null;
}

function mapNERLabel(label: string): EntityCategory | null {
  // BERT NER labels: B-PER, I-PER, B-ORG, I-ORG, B-LOC, I-LOC, B-MISC, I-MISC
  if (label.includes('PER')) return 'PERSON';
  if (label.includes('ORG')) return 'ORGANIZATION';
  if (label.includes('LOC')) return 'LOCATION';
  return null; // Skip MISC
}

function mergeSubwordTokens(results: NERResult[]): { text: string; category: EntityCategory; start: number; end: number }[] {
  const merged: { text: string; category: EntityCategory; start: number; end: number }[] = [];
  let current: { text: string; category: EntityCategory; start: number; end: number } | null = null;

  for (const r of results) {
    const category = mapNERLabel(r.entity);
    if (!category) {
      if (current) {
        merged.push(current);
        current = null;
      }
      continue;
    }

    const isBeginning = r.entity.startsWith('B-');
    const isContinuation = r.entity.startsWith('I-');

    if (isBeginning || !current || (isContinuation && current.category !== category)) {
      if (current) merged.push(current);
      current = { text: r.word, category, start: r.start, end: r.end };
    } else {
      // Continuation token - merge
      const gap = r.word.startsWith('##') ? '' : ' ';
      const cleanWord = r.word.replace(/^##/, '');
      current.text += gap + cleanWord;
      current.end = r.end;
    }
  }

  if (current) merged.push(current);
  return merged;
}

export function useNERModel() {
  const [state, setState] = useState<NERModelState>({
    loading: false,
    ready: false,
    progress: 0,
    error: null,
  });

  const pipelineRef = useRef<Pipeline | null>(null);

  const loadModel = useCallback(async () => {
    if (pipelineRef.current || state.loading) return;

    setState({ loading: true, ready: false, progress: 0, error: null });

    try {
      const { pipeline } = await import('@xenova/transformers');
      const ner = await pipeline('token-classification', 'Xenova/bert-base-NER', {
        progress_callback: (data: { progress?: number }) => {
          if (typeof data.progress === 'number') {
            setState((prev) => ({ ...prev, progress: Math.round(data.progress!) }));
          }
        },
      });

      pipelineRef.current = ner as unknown as Pipeline;
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
      // Process in chunks to avoid memory issues with large texts
      const maxChunkSize = 512;
      const chunks: { text: string; offset: number }[] = [];

      for (let i = 0; i < text.length; i += maxChunkSize) {
        chunks.push({ text: text.slice(i, i + maxChunkSize), offset: i });
      }

      const allEntities: DetectedEntity[] = [];

      for (const chunk of chunks) {
        const results = await pipelineRef.current(chunk.text);
        const merged = mergeSubwordTokens(results);

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
