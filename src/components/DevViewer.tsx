import React, { useState } from 'react';
import { Terminal, ChevronDown, ChevronRight } from 'lucide-react';
import { LLMDebugEntry } from '../hooks/useNERModel';

interface DevViewerProps {
  debugLog: LLMDebugEntry[];
  modelId: string;
}

export const DevViewer: React.FC<DevViewerProps> = ({ debugLog, modelId }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>('response');

  if (debugLog.length === 0) return null;

  const latest = debugLog[debugLog.length - 1];

  const toggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  return (
    <div
      className="rounded-xl overflow-hidden text-xs font-mono"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
        style={{
          background: 'var(--bg-soft)',
          borderBottom: collapsed ? 'none' : '1px solid var(--border-subtle)',
        }}
      >
        <Terminal size={14} style={{ color: 'var(--accent-primary)' }} />
        <span
          className="text-xs font-semibold flex-1"
          style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: 'var(--ink-primary)' }}
        >
          AI Transparency
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}
        >
          {modelId}
        </span>
        {collapsed ? (
          <ChevronRight size={14} style={{ color: 'var(--ink-tertiary)' }} />
        ) : (
          <ChevronDown size={14} style={{ color: 'var(--ink-tertiary)' }} />
        )}
      </button>

      {!collapsed && (
        <div className="p-3 space-y-2 max-h-[400px] overflow-y-auto">
          {/* Chunk info */}
          {latest.totalChunks > 1 && (
            <div className="text-xs" style={{ color: 'var(--ink-faint)' }}>
              Chunk {latest.chunkIndex + 1} of {latest.totalChunks}
            </div>
          )}

          {/* System Prompt */}
          <Section
            title="System Prompt"
            id="system"
            expanded={expandedSection === 'system'}
            onToggle={toggleSection}
          >
            <pre
              className="whitespace-pre-wrap text-xs leading-relaxed p-3 rounded-lg"
              style={{ background: 'var(--bg-base)', color: 'var(--ink-secondary)' }}
            >
              {latest.systemPrompt}
            </pre>
          </Section>

          {/* User Prompt */}
          <Section
            title="User Prompt"
            id="user"
            expanded={expandedSection === 'user'}
            onToggle={toggleSection}
          >
            <pre
              className="whitespace-pre-wrap text-xs leading-relaxed p-3 rounded-lg"
              style={{ background: 'var(--bg-base)', color: 'var(--ink-secondary)' }}
            >
              {latest.userPrompt}
            </pre>
          </Section>

          {/* Raw Response */}
          <Section
            title="LLM Response"
            id="response"
            expanded={expandedSection === 'response'}
            onToggle={toggleSection}
          >
            <pre
              className="whitespace-pre-wrap text-xs leading-relaxed p-3 rounded-lg"
              style={{ background: 'var(--bg-base)', color: 'var(--ink-primary)' }}
            >
              {latest.rawResponse}
            </pre>
          </Section>

          {/* Parsed Entities */}
          <Section
            title={`Parsed Entities (${latest.parsedEntities.length})`}
            id="parsed"
            expanded={expandedSection === 'parsed'}
            onToggle={toggleSection}
          >
            <div className="space-y-1 p-3 rounded-lg" style={{ background: 'var(--bg-base)' }}>
              {latest.parsedEntities.length === 0 ? (
                <span style={{ color: 'var(--ink-faint)' }}>No entities parsed</span>
              ) : (
                latest.parsedEntities.map((entity, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span
                      className="px-1.5 py-0.5 rounded text-xs font-medium"
                      style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}
                    >
                      {entity.type}
                    </span>
                    <span style={{ color: 'var(--ink-primary)' }}>{entity.text}</span>
                  </div>
                ))
              )}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
};

const Section: React.FC<{
  title: string;
  id: string;
  expanded: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}> = ({ title, id, expanded, onToggle, children }) => (
  <div>
    <button
      onClick={() => onToggle(id)}
      className="flex items-center gap-1.5 w-full text-left py-1"
    >
      {expanded ? (
        <ChevronDown size={12} style={{ color: 'var(--ink-tertiary)' }} />
      ) : (
        <ChevronRight size={12} style={{ color: 'var(--ink-tertiary)' }} />
      )}
      <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {title}
      </span>
    </button>
    {expanded && children}
  </div>
);
