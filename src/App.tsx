import React, { useState, useCallback, useEffect } from 'react';
import { Shield, Loader2 } from 'lucide-react';
import { DropZone } from './components/DropZone';
import { DocumentViewer } from './components/DocumentViewer';
import { EntityList } from './components/EntityList';
import { RedactControls } from './components/RedactControls';
import { ShareCard } from './components/ShareCard';
import { DevViewer } from './components/DevViewer';
import { ThemeToggle } from './components/ThemeToggle';
import { usePDFParser } from './hooks/usePDFParser';
import { useNERModel, MODEL_ID } from './hooks/useNERModel';
import { detectWithRegex } from './lib/regex-patterns';
import { redactText, RedactStyle } from './lib/redactor';
import { createRedactedPDF } from './lib/pdf-redactor';
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

  const [redactedPdfBytes, setRedactedPdfBytes] = useState<Uint8Array | null>(null);
  const [redacting, setRedacting] = useState(false);

  const handleRedact = useCallback(async () => {
    if (!pdf.text) return;

    if (pdf.isPDF) {
      const pdfDoc = pdf.getPDFDocument();
      if (!pdfDoc) return;
      setRedacting(true);
      try {
        const bytes = await createRedactedPDF(pdfDoc, entities, pdf.pages);
        setRedactedPdfBytes(bytes);
        // Also produce text version for preview
        const result = redactText(pdf.text, entities, redactStyle);
        setRedactedText(result);
        setAppState('redacted');
      } finally {
        setRedacting(false);
      }
    } else {
      const result = redactText(pdf.text, entities, redactStyle);
      setRedactedText(result);
      setAppState('redacted');
    }
  }, [pdf.text, pdf.isPDF, pdf.pages, entities, redactStyle]);

  const handleDownload = useCallback(() => {
    if (redactedPdfBytes) {
      // Download redacted PDF
      const blob = new Blob([redactedPdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdf.fileName
        ? pdf.fileName.replace(/\.pdf$/i, '_redacted.pdf')
        : 'redacted.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } else if (redactedText) {
      // Download redacted text
      const blob = new Blob([redactedText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdf.fileName
        ? pdf.fileName.replace(/\.pdf$/i, '_redacted.txt')
        : 'redacted.txt';
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [redactedText, redactedPdfBytes, pdf.fileName]);

  const handleStartOver = useCallback(() => {
    setAppState('input');
    setEntities([]);
    setRedactedText(null);
    setRedactedPdfBytes(null);
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
              {/* AI model loading indicator */}
              {ner.loading && (
                <div className="glass-panel rounded-2xl overflow-hidden">
                  <div className="p-6 text-center">
                    <div className="relative w-16 h-16 mx-auto mb-4">
                      <div
                        className="absolute inset-0 rounded-full"
                        style={{ border: '2px solid var(--border-subtle)' }}
                      />
                      <div
                        className="absolute inset-0 rounded-full animate-spin"
                        style={{ borderTop: '2px solid var(--accent-primary)', borderRight: '2px solid transparent', borderBottom: '2px solid transparent', borderLeft: '2px solid transparent' }}
                      />
                      <div
                        className="absolute inset-2.5 rounded-full"
                        style={{ borderRight: '2px solid var(--accent-primary)', borderTop: '2px solid transparent', borderBottom: '2px solid transparent', borderLeft: '2px solid transparent', opacity: 0.6, animation: 'spin 1.5s linear infinite reverse' }}
                      />
                    </div>

                    <h3
                      className="text-sm font-semibold mb-1"
                      style={{ color: 'var(--ink-primary)' }}
                    >
                      Loading AI Detection Model
                    </h3>
                    <p className="text-xs mb-4" style={{ color: 'var(--ink-tertiary)' }}>
                      Downloading and initializing (~500MB)
                    </p>

                    <div className="max-w-xs mx-auto">
                      <div className="flex justify-between text-xs mb-1.5">
                        <span style={{ color: 'var(--ink-secondary)' }}>Progress</span>
                        <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
                          {ner.progress}%
                        </span>
                      </div>
                      <div
                        className="h-2.5 rounded-full overflow-hidden"
                        style={{ background: 'var(--bg-elevated)' }}
                      >
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{ width: `${ner.progress}%`, background: 'var(--accent-primary)' }}
                        />
                      </div>
                    </div>

                    <p className="text-xs mt-3" style={{ color: 'var(--ink-faint)' }}>
                      First load may take a minute. Cached for future use.
                    </p>
                  </div>
                </div>
              )}

              <DocumentViewer
                text={pdf.text}
                entities={entities}
                onEntityClick={handleToggleEntity}
              />
              <DevViewer debugLog={ner.debugLog} modelId={MODEL_ID} />
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
                redacting={redacting}
                isPDF={pdf.isPDF}
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
                isPDF={pdf.isPDF}
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
