import React, { useState, useEffect } from 'react';
import { Plus, Tags } from 'lucide-react';
import type { KeywordMatchSummary } from '../lib/keyword-matcher';

interface KeywordRedactionPanelProps {
  onAddKeywords: (keywords: string, options: { caseSensitive: boolean; wholeWord: boolean }) => KeywordMatchSummary;
  disabled?: boolean;
}

export const KeywordRedactionPanel: React.FC<KeywordRedactionPanelProps> = ({
  onAddKeywords,
  disabled = false,
}) => {
  const [keywords, setKeywords] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(true);
  const [summary, setSummary] = useState<KeywordMatchSummary | null>(null);

  useEffect(() => {
    if (disabled) setSummary(null);
  }, [disabled]);

  const handleSubmit = () => {
    if (!keywords.trim() || disabled) return;
    setSummary(onAddKeywords(keywords, { caseSensitive, wholeWord }));
    setKeywords('');
  };

  return (
    <div className="glass-panel rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Tags size={15} style={{ color: 'var(--pii-custom)' }} />
        <h3 className="text-sm font-semibold flex-1" style={{ color: 'var(--ink-primary)' }}>
          Keyword Redaction
        </h3>
      </div>

      <textarea
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        disabled={disabled}
        rows={3}
        placeholder="Project Atlas&#10;CONFIDENTIAL&#10;MRN-448201"
        className="w-full rounded-xl p-3 text-xs resize-none focus:outline-none"
        style={{
          background: 'var(--bg-input)',
          color: 'var(--ink-primary)',
          border: '1px solid var(--border-default)',
          opacity: disabled ? 0.5 : 1,
        }}
      />

      <div className="grid grid-cols-2 gap-2">
        <label
          className="flex items-center gap-2 text-xs rounded-lg px-2 py-1.5"
          style={{ background: 'var(--bg-soft)', color: 'var(--ink-tertiary)' }}
        >
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(e) => setWholeWord(e.target.checked)}
            disabled={disabled}
          />
          Whole word
        </label>
        <label
          className="flex items-center gap-2 text-xs rounded-lg px-2 py-1.5"
          style={{ background: 'var(--bg-soft)', color: 'var(--ink-tertiary)' }}
        >
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
            disabled={disabled}
          />
          Match case
        </label>
      </div>

      <button
        onClick={handleSubmit}
        disabled={disabled || !keywords.trim()}
        className="btn-secondary w-full text-xs h-9"
        style={{ opacity: !disabled && keywords.trim() ? 1 : 0.45 }}
      >
        <Plus size={14} />
        Add Keyword Matches
      </button>

      {summary && (
        <p className="text-xs" style={{ color: summary.matchCount > 0 ? 'var(--ink-tertiary)' : 'var(--warning)' }}>
          Added {summary.matchCount} match{summary.matchCount === 1 ? '' : 'es'} from {summary.keywordCount} keyword{summary.keywordCount === 1 ? '' : 's'}
          {summary.skippedOverlapCount > 0 ? ` (${summary.skippedOverlapCount} skipped overlap)` : ''}.
        </p>
      )}
    </div>
  );
};
