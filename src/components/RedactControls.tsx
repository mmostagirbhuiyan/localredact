import React from 'react';
import { ShieldCheck, Download, CheckCheck, XCircle, Loader2 } from 'lucide-react';
import { RedactStyle } from '../lib/redactor';

interface RedactControlsProps {
  entityCount: number;
  acceptedCount: number;
  redactStyle: RedactStyle;
  onRedactStyleChange: (style: RedactStyle) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onRedact: () => void;
  onDownload: () => void;
  redacted: boolean;
  redacting?: boolean;
  redactProgress?: string;
  isPDF?: boolean;
}

export const RedactControls: React.FC<RedactControlsProps> = ({
  entityCount,
  acceptedCount,
  redactStyle,
  onRedactStyleChange,
  onAcceptAll,
  onRejectAll,
  onRedact,
  onDownload,
  redacted,
  redacting = false,
  redactProgress = '',
  isPDF = false,
}) => {
  return (
    <div className="glass-panel rounded-2xl p-4 space-y-4">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
        Redaction Controls
      </h3>

      {/* Bulk actions */}
      <div className="flex gap-2">
        <button
          onClick={onAcceptAll}
          className="btn-secondary flex-1 text-xs h-9"
        >
          <CheckCheck size={14} />
          Accept All
        </button>
        <button
          onClick={onRejectAll}
          className="btn-secondary flex-1 text-xs h-9"
        >
          <XCircle size={14} />
          Reject All
        </button>
      </div>

      {/* Redact style */}
      <div>
        <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--ink-tertiary)' }}>
          Redaction Style
        </label>
        <div
          className="flex items-center gap-1 p-1 rounded-full"
          style={{ background: 'var(--bg-soft)', border: '1px solid var(--border-subtle)' }}
        >
          <button
            onClick={() => onRedactStyleChange('text')}
            className="flex-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200"
            style={{
              background: redactStyle === 'text' ? 'var(--bg-elevated)' : 'transparent',
              color: redactStyle === 'text' ? 'var(--ink-primary)' : 'var(--ink-tertiary)',
              boxShadow: redactStyle === 'text' ? 'var(--shadow-sm)' : 'none',
            }}
          >
            [REDACTED]
          </button>
          <button
            onClick={() => onRedactStyleChange('blocks')}
            className="flex-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200"
            style={{
              background: redactStyle === 'blocks' ? 'var(--bg-elevated)' : 'transparent',
              color: redactStyle === 'blocks' ? 'var(--ink-primary)' : 'var(--ink-tertiary)',
              boxShadow: redactStyle === 'blocks' ? 'var(--shadow-sm)' : 'none',
            }}
          >
            {'\u2588\u2588\u2588\u2588'}
          </button>
        </div>
      </div>

      {/* Actions */}
      {!redacted ? (
        <button
          onClick={onRedact}
          disabled={acceptedCount === 0 || redacting}
          className="btn-primary w-full"
          style={{ opacity: acceptedCount > 0 && !redacting ? 1 : 0.5 }}
        >
          {redacting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {redactProgress || 'Redacting PDF...'}
            </>
          ) : (
            <>
              <ShieldCheck size={16} />
              Redact {acceptedCount} Entities
            </>
          )}
        </button>
      ) : (
        <button onClick={onDownload} className="btn-primary w-full">
          <Download size={16} />
          Download {isPDF ? 'Redacted PDF' : 'Redacted Text'}
        </button>
      )}

      {entityCount > 0 && (
        <p className="text-xs text-center" style={{ color: 'var(--ink-tertiary)' }}>
          {acceptedCount} of {entityCount} entities selected for redaction
        </p>
      )}
    </div>
  );
};
