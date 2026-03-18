import React from 'react';
import { ShieldCheck, Lock, Clock, Cpu, FileText, ScanText } from 'lucide-react';
import { motion } from 'framer-motion';
import type { ScanMetrics } from '../App';
import { DetectedEntity, ENTITY_CONFIG, EntityCategory } from '../lib/entity-types';

interface ShareCardProps {
  entityCount: number;
  visible: boolean;
  scanMetrics?: ScanMetrics | null;
  entities?: DetectedEntity[];
}

function formatTime(ms: number): string {
  if (ms < 100) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const ShareCard: React.FC<ShareCardProps> = ({ entityCount, visible, scanMetrics, entities }) => {
  if (!visible) return null;

  // Count entities by category
  const categoryCounts: Partial<Record<EntityCategory, number>> = {};
  if (entities) {
    for (const e of entities) {
      if (e.accepted) {
        categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
      }
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-lg mx-auto"
    >
      <div
        className="rounded-2xl p-8 text-center"
        style={{
          background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-elevated) 100%)',
          border: '1px solid var(--border-default)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ background: 'var(--success-soft)' }}
        >
          <ShieldCheck size={28} style={{ color: 'var(--success)' }} />
        </div>

        <h3
          className="text-2xl font-bold mb-2"
          style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: 'var(--ink-primary)' }}
        >
          Redacted {entityCount} PII {entityCount === 1 ? 'entity' : 'entities'}
        </h3>

        <div
          className="flex items-center justify-center gap-2 text-sm mb-4"
          style={{ color: 'var(--ink-secondary)' }}
        >
          <Lock size={14} />
          Zero bytes uploaded
        </div>

        {/* Performance metrics */}
        {scanMetrics && (
          <div
            className="rounded-xl p-3 mb-4"
            style={{ background: 'var(--bg-soft)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-tertiary)' }}>
                <Clock size={12} style={{ color: 'var(--accent-primary)' }} />
                <span style={{ color: 'var(--ink-secondary)' }}>{formatTime(scanMetrics.totalScanMs)}</span>
                total
              </div>
              {scanMetrics.regexMs > 0 && (
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-tertiary)' }}>
                  <ScanText size={12} style={{ color: 'var(--success)' }} />
                  <span style={{ color: 'var(--ink-secondary)' }}>{formatTime(scanMetrics.regexMs)}</span>
                  regex
                </div>
              )}
              {scanMetrics.llmMs !== null && (
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-tertiary)' }}>
                  <Cpu size={12} style={{ color: 'var(--accent-secondary)' }} />
                  <span style={{ color: 'var(--ink-secondary)' }}>{formatTime(scanMetrics.llmMs)}</span>
                  LLM ({scanMetrics.llmChunkCount} {scanMetrics.llmChunkCount === 1 ? 'chunk' : 'chunks'})
                </div>
              )}
              {scanMetrics.pagesProcessed > 0 && (
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-tertiary)' }}>
                  <FileText size={12} style={{ color: 'var(--ink-tertiary)' }} />
                  <span style={{ color: 'var(--ink-secondary)' }}>{scanMetrics.pagesProcessed}</span>
                  {scanMetrics.pagesProcessed === 1 ? 'page' : 'pages'}
                  {scanMetrics.ocrPages > 0 && (
                    <span>({scanMetrics.ocrPages} OCR)</span>
                  )}
                </div>
              )}
            </div>

            {/* Entity category breakdown */}
            {Object.keys(categoryCounts).length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                {(Object.entries(categoryCounts) as [EntityCategory, number][]).map(([cat, count]) => (
                  <span
                    key={cat}
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background: `var(${ENTITY_CONFIG[cat].softVar})`,
                      color: `var(${ENTITY_CONFIG[cat].colorVar})`,
                    }}
                  >
                    {count} {ENTITY_CONFIG[cat].label}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-xs" style={{ color: 'var(--ink-tertiary)' }}>
          Powered by LocalRedact - your document never leaves your browser
        </p>
      </div>
    </motion.div>
  );
};
