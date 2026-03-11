import React, { useMemo, useEffect, useRef } from 'react';
import { DetectedEntity, ENTITY_CONFIG } from '../lib/entity-types';

interface DocumentViewerProps {
  text: string;
  entities: DetectedEntity[];
  onEntityClick: (id: string) => void;
  focusedEntityId?: string | null;
}

interface TextSegment {
  text: string;
  entity: DetectedEntity | null;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({ text, entities, onEntityClick, focusedEntityId }) => {
  const focusedRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (focusedEntityId && focusedRef.current) {
      focusedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [focusedEntityId]);

  const segments = useMemo(() => {
    const accepted = entities
      .filter((e) => e.accepted)
      .sort((a, b) => a.start - b.start);

    const result: TextSegment[] = [];
    let cursor = 0;

    for (const entity of accepted) {
      if (entity.start > cursor) {
        result.push({ text: text.slice(cursor, entity.start), entity: null });
      }
      result.push({ text: text.slice(entity.start, entity.end), entity });
      cursor = entity.end;
    }

    if (cursor < text.length) {
      result.push({ text: text.slice(cursor), entity: null });
    }

    return result;
  }, [text, entities]);

  return (
    <div
      className="glass-panel rounded-2xl p-6 overflow-auto max-h-[60vh]"
    >
      <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--ink-primary)' }}>
        {segments.map((seg, i) => {
          if (!seg.entity) {
            return <span key={i}>{seg.text}</span>;
          }

          const config = ENTITY_CONFIG[seg.entity.category];
          const isFocused = focusedEntityId === seg.entity.id;
          return (
            <span
              key={i}
              ref={isFocused ? focusedRef : undefined}
              onClick={() => onEntityClick(seg.entity!.id)}
              className="cursor-pointer rounded px-0.5 transition-all duration-150 hover:opacity-80"
              style={{
                background: `var(${config.softVar})`,
                borderBottom: `2px solid var(${config.colorVar})`,
                color: `var(${config.colorVar})`,
                outline: isFocused ? `2px solid var(${config.colorVar})` : 'none',
                outlineOffset: '1px',
              }}
              title={`${config.label}: ${seg.text}`}
            >
              {seg.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};
