import React from 'react';
import { Check, X, Eye } from 'lucide-react';
import { DetectedEntity, ENTITY_CONFIG } from '../lib/entity-types';

interface EntityListProps {
  entities: DetectedEntity[];
  onToggle: (id: string) => void;
  onScrollTo: (id: string) => void;
  onToggleCategory?: (category: string, accepted: boolean) => void;
}

export const EntityList: React.FC<EntityListProps> = ({ entities, onToggle, onScrollTo, onToggleCategory }) => {
  const grouped = entities.reduce<Record<string, DetectedEntity[]>>((acc, entity) => {
    const key = entity.category;
    if (!acc[key]) acc[key] = [];
    acc[key].push(entity);
    return acc;
  }, {});

  const acceptedCount = entities.filter((e) => e.accepted).length;

  return (
    <div className="glass-panel rounded-2xl p-4 overflow-auto max-h-[60vh]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
          Detected PII
        </h3>
        <span
          className="text-xs font-medium px-2 py-1 rounded-full"
          style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}
        >
          {acceptedCount} / {entities.length}
        </span>
      </div>

      {Object.entries(grouped).map(([category, items]) => {
        const config = ENTITY_CONFIG[category as keyof typeof ENTITY_CONFIG];
        const allAccepted = items.every((e) => e.accepted);
        const noneAccepted = items.every((e) => !e.accepted);
        return (
          <div key={category} className="mb-3">
            <div
              className="flex items-center gap-2 mb-1.5 px-1"
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: `var(${config.colorVar})` }}
              />
              <span className="text-xs font-semibold uppercase tracking-wider flex-1" style={{ color: 'var(--ink-tertiary)' }}>
                {config.label} ({items.length})
              </span>
              {onToggleCategory && (
                <button
                  onClick={() => onToggleCategory(category, noneAccepted || !allAccepted)}
                  className="text-xs px-2 py-0.5 rounded-full transition-colors"
                  style={{
                    background: allAccepted ? 'var(--success-soft, rgba(34,197,94,0.1))' : 'var(--bg-soft)',
                    color: allAccepted ? 'var(--success)' : 'var(--ink-tertiary)',
                  }}
                  title={allAccepted ? `Reject all ${config.label}` : `Accept all ${config.label}`}
                >
                  {allAccepted ? 'all' : noneAccepted ? 'none' : 'mixed'}
                </button>
              )}
            </div>

            <div className="space-y-1">
              {items.map((entity) => (
                <div
                  key={entity.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all duration-150"
                  style={{
                    background: entity.accepted ? `var(${config.softVar})` : 'transparent',
                    opacity: entity.accepted ? 1 : 0.5,
                  }}
                >
                  <span
                    className="flex-1 text-xs font-mono truncate"
                    style={{ color: entity.accepted ? `var(${config.colorVar})` : 'var(--ink-tertiary)' }}
                  >
                    {entity.text}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onScrollTo(entity.id)}
                      className="p-1 rounded hover:opacity-80 transition-opacity"
                      title="Find in text"
                    >
                      <Eye size={12} style={{ color: 'var(--ink-tertiary)' }} />
                    </button>
                    <button
                      onClick={() => onToggle(entity.id)}
                      className="p-1 rounded transition-opacity"
                      title={entity.accepted ? 'Reject' : 'Accept'}
                    >
                      {entity.accepted ? (
                        <Check size={12} style={{ color: 'var(--success)' }} />
                      ) : (
                        <X size={12} style={{ color: 'var(--danger)' }} />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {entities.length === 0 && (
        <p className="text-sm text-center py-8" style={{ color: 'var(--ink-tertiary)' }}>
          No PII detected yet
        </p>
      )}
    </div>
  );
};
