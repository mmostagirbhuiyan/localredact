import React, { useState, useCallback, useEffect } from 'react';
import { Shield, Loader2 } from 'lucide-react';
import { DropZone } from './components/DropZone';
import { DocumentViewer } from './components/DocumentViewer';
import { PDFPageViewer } from './components/PDFPageViewer';
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

  // Phase 2: NER detection when model is ready and we have text to scan.
  // Track which text has been scanned to avoid duplicate runs.
  const nerScannedRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (ner.ready && pdf.text && appState === 'review' && nerScannedRef.current !== pdf.text) {
      nerScannedRef.current = pdf.text;
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
  }, [ner.ready, pdf.text, appState]);

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

  const handleToggleGroup = useCallback((ids: string[], accepted: boolean) => {
    const idSet = new Set(ids);
    setEntities((prev) =>
      prev.map((e) => (idSet.has(e.id) ? { ...e, accepted } : e)),
    );
  }, []);

  const handleToggleCategory = useCallback((category: string, accepted: boolean) => {
    setEntities((prev) =>
      prev.map((e) => (e.category === category ? { ...e, accepted } : e)),
    );
  }, []);

  const handleEditEntityText = useCallback((ids: string[], newText: string) => {
    const idSet = new Set(ids);
    setEntities((prev) =>
      prev.map((e) => (idSet.has(e.id) ? { ...e, text: newText } : e)),
    );
  }, []);

  const [redactedPdfBytes, setRedactedPdfBytes] = useState<Uint8Array | null>(null);
  const [redacting, setRedacting] = useState(false);
  const [redactProgress, setRedactProgress] = useState('');

  const handleRedact = useCallback(async () => {
    if (!pdf.text) return;

    if (pdf.isPDF) {
      const pdfDoc = pdf.getPDFDocument();
      if (!pdfDoc) return;
      setRedacting(true);
      setRedactProgress('Preparing...');
      try {
        const bytes = await createRedactedPDF(pdfDoc, entities, pdf.pages, (current, total) => {
          setRedactProgress(`Rendering page ${current}/${total}...`);
        });
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
    nerScannedRef.current = null;
    pdf.reset();
  }, [pdf]);

  // Keyboard shortcuts for entity review
  const [focusedEntityIdx, setFocusedEntityIdx] = useState<number>(-1);

  useEffect(() => {
    if (appState !== 'review' || entities.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'Tab') {
        e.preventDefault();
        setFocusedEntityIdx((prev) => {
          const next = e.shiftKey ? prev - 1 : prev + 1;
          if (next < 0) return entities.length - 1;
          if (next >= entities.length) return 0;
          return next;
        });
      } else if (e.key === 'Enter' && focusedEntityIdx >= 0) {
        e.preventDefault();
        const entity = entities[focusedEntityIdx];
        if (entity && !entity.accepted) {
          setEntities((prev) =>
            prev.map((ent) => (ent.id === entity.id ? { ...ent, accepted: true } : ent)),
          );
        }
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && focusedEntityIdx >= 0) {
        e.preventDefault();
        const entity = entities[focusedEntityIdx];
        if (entity && entity.accepted) {
          setEntities((prev) =>
            prev.map((ent) => (ent.id === entity.id ? { ...ent, accepted: false } : ent)),
          );
        }
      } else if (e.key === ' ' && focusedEntityIdx >= 0) {
        e.preventDefault();
        const entity = entities[focusedEntityIdx];
        if (entity) handleToggleEntity(entity.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appState, entities, focusedEntityIdx, handleToggleEntity]);

  // Reset focus when entities change significantly
  useEffect(() => {
    if (focusedEntityIdx >= entities.length) {
      setFocusedEntityIdx(entities.length > 0 ? entities.length - 1 : -1);
    }
  }, [entities.length, focusedEntityIdx]);

  const focusedEntityId = focusedEntityIdx >= 0 ? entities[focusedEntityIdx]?.id ?? null : null;

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
                      Downloading and initializing (~2.5GB, one-time)
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

              {/* LLM inference progress — shows while processing chunks */}
              {!ner.loading && ner.inferenceProgress && (
                <div
                  className="glass-panel rounded-2xl overflow-hidden px-5 py-3 flex items-center gap-4"
                >
                  <Loader2
                    size={16}
                    className="animate-spin flex-shrink-0"
                    style={{ color: 'var(--accent-primary)' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
                        AI scanning text
                      </span>
                      <span className="text-xs font-medium" style={{ color: 'var(--ink-primary)' }}>
                        Chunk {ner.inferenceProgress.current} of {ner.inferenceProgress.total}
                      </span>
                    </div>
                    <div
                      className="h-1.5 rounded-full overflow-hidden"
                      style={{ background: 'var(--bg-elevated)' }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.round((ner.inferenceProgress.current / ner.inferenceProgress.total) * 100)}%`,
                          background: 'var(--accent-primary)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {pdf.isPDF && pdf.getPDFDocument() ? (
                <PDFPageViewer
                  pdfDoc={pdf.getPDFDocument()!}
                  pages={pdf.pages}
                  entities={entities}
                  mode="review"
                  focusedEntityId={focusedEntityId}
                  onEntityClick={handleToggleEntity}
                />
              ) : (
                <DocumentViewer
                  text={pdf.text}
                  entities={entities}
                  onEntityClick={handleToggleEntity}
                  focusedEntityId={focusedEntityId}
                />
              )}
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
                redactProgress={redactProgress}
                isPDF={pdf.isPDF}
              />
              {entities.length > 0 && (
                <div
                  className="text-xs px-3 py-2 rounded-lg"
                  style={{ background: 'var(--bg-soft)', color: 'var(--ink-faint)' }}
                >
                  <span className="font-medium" style={{ color: 'var(--ink-tertiary)' }}>Keyboard:</span>{' '}
                  Tab/Shift+Tab navigate, Space toggle, Enter accept, Delete reject
                </div>
              )}
              <EntityList
                entities={entities}
                onToggle={handleToggleEntity}
                onToggleGroup={handleToggleGroup}
                onScrollTo={handleToggleEntity}
                onToggleCategory={handleToggleCategory}
                onEditText={handleEditEntityText}
                focusedEntityId={focusedEntityId}
              />
            </div>
          </div>
        )}

        {/* Redacted state */}
        {appState === 'redacted' && (redactedText || redactedPdfBytes) && (
          <div className="space-y-6">
            <ShareCard
              entityCount={acceptedCount}
              visible={true}
            />

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
              {pdf.isPDF && pdf.getPDFDocument() ? (
                <PDFPageViewer
                  pdfDoc={pdf.getPDFDocument()!}
                  pages={pdf.pages}
                  entities={entities}
                  mode="redacted"
                  onEntityClick={handleToggleEntity}
                />
              ) : (
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
              )}

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
