import React from 'react';
import { Check, X, Eye } from 'lucide-react';
import { DetectedEntity, ENTITY_CONFIG } from '../lib/entity-types';

interface EntityListProps {
  entities: DetectedEntity[];
  onToggle: (id: string) => void;
  onToggleGroup?: (ids: string[], accepted: boolean) => void;
  onScrollTo: (id: string) => void;
  onToggleCategory?: (category: string, accepted: boolean) => void;
  focusedEntityId?: string | null;
}

interface EntityGroup {
  text: string;
  category: string;
  ids: string[];
  allAccepted: boolean;
  noneAccepted: boolean;
  firstId: string;
}

export const EntityList: React.FC<EntityListProps> = ({ entities, onToggle, onToggleGroup, onScrollTo, onToggleCategory, focusedEntityId }) => {
  // Group by category first, then collapse duplicates within each category
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

        // Collapse duplicate text into groups
        const deduped: EntityGroup[] = [];
        const seen = new Map<string, EntityGroup>();
        for (const entity of items) {
          const key = entity.text.toLowerCase().trim();
          const existing = seen.get(key);
          if (existing) {
            existing.ids.push(entity.id);
            existing.allAccepted = existing.allAccepted && entity.accepted;
            existing.noneAccepted = existing.noneAccepted && !entity.accepted;
          } else {
            const group: EntityGroup = {
              text: entity.text,
              category: entity.category,
              ids: [entity.id],
              allAccepted: entity.accepted,
              noneAccepted: !entity.accepted,
              firstId: entity.id,
            };
            seen.set(key, group);
            deduped.push(group);
          }
        }

        // Unique count for the category header
        const uniqueCount = deduped.length;
        const totalCount = items.length;

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
                {config.label} ({uniqueCount !== totalCount ? `${uniqueCount} unique, ${totalCount} total` : totalCount})
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
              {deduped.map((group) => {
                const isFocused = group.ids.includes(focusedEntityId || '');
                return (
                  <div
                    key={group.firstId}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all duration-150"
                    style={{
                      background: group.allAccepted ? `var(${config.softVar})` : 'transparent',
                      opacity: group.allAccepted ? 1 : group.noneAccepted ? 0.5 : 0.75,
                      outline: isFocused ? `2px solid var(${config.colorVar})` : 'none',
                      outlineOffset: '-1px',
                    }}
                  >
                    <span
                      className="flex-1 text-xs font-mono truncate"
                      style={{ color: group.allAccepted ? `var(${config.colorVar})` : 'var(--ink-tertiary)' }}
                    >
                      {group.text}
                    </span>

                    <div className="flex items-center gap-1">
                      {group.ids.length > 1 && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded-full"
                          style={{ background: 'var(--bg-soft)', color: 'var(--ink-faint)' }}
                        >
                          {group.ids.length}x
                        </span>
                      )}
                      <button
                        onClick={() => onScrollTo(group.firstId)}
                        className="p-1 rounded hover:opacity-80 transition-opacity"
                        title="Find in text"
                      >
                        <Eye size={12} style={{ color: 'var(--ink-tertiary)' }} />
                      </button>
                      <button
                        onClick={() => {
                          if (group.ids.length > 1 && onToggleGroup) {
                            onToggleGroup(group.ids, group.noneAccepted || !group.allAccepted);
                          } else {
                            onToggle(group.firstId);
                          }
                        }}
                        className="p-1 rounded transition-opacity"
                        title={group.allAccepted ? 'Reject' : 'Accept'}
                      >
                        {group.allAccepted ? (
                          <Check size={12} style={{ color: 'var(--success)' }} />
                        ) : (
                          <X size={12} style={{ color: 'var(--danger)' }} />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
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
