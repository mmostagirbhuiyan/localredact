import React, { useState, useCallback, useEffect } from 'react';
import { Shield, Loader2 } from 'lucide-react';
import { DropZone } from './components/DropZone';
import { DocumentViewer } from './components/DocumentViewer';
import { EntityList } from './components/EntityList';
import { RedactControls } from './components/RedactControls';
import { ShareCard } from './components/ShareCard';
import { ThemeToggle } from './components/ThemeToggle';
import { usePDFParser } from './hooks/usePDFParser';
import { useNERModel } from './hooks/useNERModel';
import { detectWithRegex } from './lib/regex-patterns';
import { redactText, RedactStyle } from './lib/redactor';
import { DetectedEntity } from './lib/entity-types';

type AppState = 'input' | 'scanning' | 'review' | 'redacted';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('input');
  const [entities, setEntities] = useState<DetectedEntity[]>([]);
  const [redactStyle, setRedactStyle] = useState<RedactStyle>('text');
  const [redactedText, setRedactedText] = useState<string | null>(null);

  const pdf = usePDFParser();
  const ner = useNERModel();

  // Phase 1: Instant regex detection when text is available
  useEffect(() => {
    if (pdf.text && appState === 'scanning') {
      const regexEntities = detectWithRegex(pdf.text);
      setEntities(regexEntities);
      setAppState('review');

      // Phase 2: Start NER model loading
      ner.loadModel();
    }
  }, [pdf.text, appState]);

  // Phase 2: NER detection when model is ready
  useEffect(() => {
    if (ner.ready && pdf.text && appState === 'review') {
      ner.detect(pdf.text).then((nerEntities) => {
        setEntities((prev) => {
          // Merge NER entities, avoiding overlaps with regex entities
          const existing = new Set(prev.map((e) => `${e.start}-${e.end}`));
          const newEntities = nerEntities.filter(
            (e) => !existing.has(`${e.start}-${e.end}`),
          );
          return [...prev, ...newEntities].sort((a, b) => a.start - b.start);
        });
      });
    }
  }, [ner.ready]);

  const handleFileSelect = useCallback(
    (file: File) => {
      setAppState('scanning');
      setEntities([]);
      setRedactedText(null);
      pdf.parseFile(file);
    },
    [pdf],
  );

  const handleTextPaste = useCallback(
    (text: string) => {
      setAppState('scanning');
      setEntities([]);
      setRedactedText(null);
      pdf.setText(text);
    },
    [pdf],
  );

  const handleToggleEntity = useCallback((id: string) => {
    setEntities((prev) =>
      prev.map((e) => (e.id === id ? { ...e, accepted: !e.accepted } : e)),
    );
  }, []);

  const handleAcceptAll = useCallback(() => {
    setEntities((prev) => prev.map((e) => ({ ...e, accepted: true })));
  }, []);

  const handleRejectAll = useCallback(() => {
    setEntities((prev) => prev.map((e) => ({ ...e, accepted: false })));
  }, []);

  const handleRedact = useCallback(() => {
    if (!pdf.text) return;
    const result = redactText(pdf.text, entities, redactStyle);
    setRedactedText(result);
    setAppState('redacted');
  }, [pdf.text, entities, redactStyle]);

  const handleDownload = useCallback(() => {
    if (!redactedText) return;
    const blob = new Blob([redactedText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pdf.fileName
      ? pdf.fileName.replace(/\.pdf$/i, '_redacted.txt')
      : 'redacted.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [redactedText, pdf.fileName]);

  const handleStartOver = useCallback(() => {
    setAppState('input');
    setEntities([]);
    setRedactedText(null);
    pdf.reset();
  }, [pdf]);

  const acceptedCount = entities.filter((e) => e.accepted).length;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-50 px-6 py-4 flex items-center justify-between"
        style={{
          background: 'var(--bg-base)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--accent-primary-soft)' }}
          >
            <Shield size={18} style={{ color: 'var(--accent-primary)' }} />
          </div>
          <h1
            className="text-lg font-bold"
            style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: 'var(--ink-primary)' }}
          >
            LocalRedact
          </h1>
        </div>

        <div className="flex items-center gap-4">
          {appState !== 'input' && (
            <button
              onClick={handleStartOver}
              className="text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
              style={{ color: 'var(--ink-tertiary)', background: 'var(--bg-soft)' }}
            >
              Start Over
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Input state */}
        {appState === 'input' && (
          <div className="flex flex-col items-center gap-8">
            <div className="text-center max-w-lg">
              <h2
                className="text-3xl font-bold mb-3"
                style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: 'var(--ink-primary)' }}
              >
                Redact PII. Locally.
              </h2>
              <p className="text-base" style={{ color: 'var(--ink-secondary)' }}>
                Your document never leaves your browser. Not even to our server. Because we don't have one.
              </p>
            </div>
            <DropZone
              onFileSelect={handleFileSelect}
              onTextPaste={handleTextPaste}
              loading={pdf.loading}
            />
          </div>
        )}

        {/* Scanning state */}
        {appState === 'scanning' && pdf.loading && (
          <div className="flex flex-col items-center gap-4 py-20">
            <Loader2
              size={32}
              className="animate-spin"
              style={{ color: 'var(--accent-primary)' }}
            />
            <p style={{ color: 'var(--ink-secondary)' }}>Parsing document...</p>
          </div>
        )}

        {/* Review state */}
        {appState === 'review' && pdf.text && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
            <div className="space-y-4">
              {/* NER loading indicator */}
              {ner.loading && (
                <div
                  className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: 'var(--accent-primary-soft)', border: '1px solid var(--accent-primary)' }}
                >
                  <Loader2
                    size={14}
                    className="animate-spin"
                    style={{ color: 'var(--accent-primary)' }}
                  />
                  <span className="text-xs" style={{ color: 'var(--accent-primary)' }}>
                    Loading AI model for name/org/location detection... {ner.progress}%
                  </span>
                </div>
              )}

              <DocumentViewer
                text={pdf.text}
                entities={entities}
                onEntityClick={handleToggleEntity}
              />
            </div>

            <div className="space-y-4">
              <RedactControls
                entityCount={entities.length}
                acceptedCount={acceptedCount}
                redactStyle={redactStyle}
                onRedactStyleChange={setRedactStyle}
                onAcceptAll={handleAcceptAll}
                onRejectAll={handleRejectAll}
                onRedact={handleRedact}
                onDownload={handleDownload}
                redacted={false}
              />
              <EntityList
                entities={entities}
                onToggle={handleToggleEntity}
                onScrollTo={handleToggleEntity}
              />
            </div>
          </div>
        )}

        {/* Redacted state */}
        {appState === 'redacted' && redactedText && (
          <div className="space-y-6">
            <ShareCard
              entityCount={acceptedCount}
              visible={true}
            />

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
              <div
                className="glass-panel rounded-2xl p-6 overflow-auto max-h-[60vh]"
              >
                <div
                  className="text-sm leading-relaxed whitespace-pre-wrap font-mono"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  {redactedText}
                </div>
              </div>

              <RedactControls
                entityCount={entities.length}
                acceptedCount={acceptedCount}
                redactStyle={redactStyle}
                onRedactStyleChange={setRedactStyle}
                onAcceptAll={handleAcceptAll}
                onRejectAll={handleRejectAll}
                onRedact={handleRedact}
                onDownload={handleDownload}
                redacted={true}
              />
            </div>
          </div>
        )}

        {/* Error display */}
        {pdf.error && (
          <div
            className="mt-4 p-4 rounded-xl text-sm"
            style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
          >
            {pdf.error}
          </div>
        )}

        {ner.error && (
          <div
            className="mt-4 p-4 rounded-xl text-sm"
            style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}
          >
            AI detection unavailable: {ner.error}. Regex detection still active.
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center py-6 text-xs" style={{ color: 'var(--ink-faint)' }}>
        100% client-side. Zero data leaves your browser.
      </footer>
    </div>
  );
};

export default App;
