import React, { useState, useCallback, useEffect } from 'react';
import { Loader2, Columns2, FileText, Files, ChevronRight, Check, Download, SkipForward, Cpu, Eye, Lock, Smartphone } from 'lucide-react';
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
import { useOCR } from './hooks/useOCR';
import type { OCRPageResult } from './hooks/useOCR';
import { detectWithRegex } from './lib/regex-patterns';
import { redactText, RedactStyle } from './lib/redactor';
import { createRedactedPDF } from './lib/pdf-redactor';
import { DetectedEntity, EntityCategory, ENTITY_CONFIG } from './lib/entity-types';
import { generateRedactionReport } from './lib/redaction-report';

type AppState = 'input' | 'scanning' | 'review' | 'redacted';

interface QueueItem {
  file: File;
  status: 'pending' | 'active' | 'done' | 'skipped';
  redactedBytes?: Uint8Array;
  entityCount?: number;
}

const ALL_CATEGORIES = Object.keys(ENTITY_CONFIG) as EntityCategory[];
const defaultCategoryRules = (): Record<EntityCategory, boolean> =>
  Object.fromEntries(ALL_CATEGORIES.map(c => [c, true])) as Record<EntityCategory, boolean>;

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('input');
  const [entities, setEntities] = useState<DetectedEntity[]>([]);
  const [redactStyle, setRedactStyle] = useState<RedactStyle>('text');
  const [redactedText, setRedactedText] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [fileQueue, setFileQueue] = useState<QueueItem[]>([]);
  const [activeQueueIdx, setActiveQueueIdx] = useState(-1);
  const [batchCategoryRules, setBatchCategoryRules] = useState<Record<EntityCategory, boolean>>(defaultCategoryRules);
  const [redactedPdfBytes, setRedactedPdfBytes] = useState<Uint8Array | null>(null);
  const [redacting, setRedacting] = useState(false);
  const [redactProgress, setRedactProgress] = useState('');

  const pdf = usePDFParser();
  const ner = useNERModel();
  const ocr = useOCR();
  const [ocrResults, setOcrResults] = useState<OCRPageResult[]>([]);

  // OCR fallback: when text quality is poor, extract text via Tesseract.js
  const [visionText, setVisionText] = useState<string | null>(null);
  const visionScannedRef = React.useRef<string | null>(null);

  // The text used for detection — vision-extracted text overrides pdfjs text
  const detectionText = visionText ?? pdf.text;

  // Phase 1: Instant regex detection when text is available
  // Also handles scanned PDFs where pdf.text is empty but pages exist
  useEffect(() => {
    if (appState !== 'scanning') return;
    if (pdf.loading) return;

    const hasText = pdf.text && pdf.text.trim().length > 0;
    const hasPages = pdf.isPDF && pdf.pages.length > 0;

    // Nothing to work with
    if (!hasText && !hasPages) return;

    if (hasText) {
      let regexEntities = detectWithRegex(pdf.text!);
      if (fileQueue.length > 1) {
        regexEntities = regexEntities.map(e => ({
          ...e,
          accepted: batchCategoryRules[e.category] ?? true,
        }));
      }
      setEntities(regexEntities);
    }

    setAppState('review');

    // Phase 2: Start NER model loading (only if we have text for it)
    if (hasText) {
      ner.loadModel();
    }

    // Phase 2b: If text quality is poor or no text at all, start OCR
    if (pdf.textQuality?.needsVision) {
      ocr.loadWorker();
    }
  }, [pdf.text, pdf.loading, pdf.isPDF, pdf.pages.length, appState]);

  // OCR extraction: when worker is ready and pages need OCR fallback
  useEffect(() => {
    if (
      ocr.ready &&
      pdf.isPDF &&
      pdf.textQuality?.needsVision &&
      appState === 'review' &&
      visionScannedRef.current !== pdf.fileName
    ) {
      visionScannedRef.current = pdf.fileName;
      const pdfDoc = pdf.getPDFDocument();
      if (!pdfDoc) return;

      const pagesToScan = pdf.textQuality.pagesNeedingVision;
      console.log(`[OCR] Extracting text from ${pagesToScan.length} pages via Tesseract.js...`);

      ocr.ocrPDFPages(pdfDoc, pagesToScan).then(({ pages: ocrPages }) => {
        // Store OCR results for coordinate mapping during redaction
        setOcrResults(ocrPages);

        // Build combined text from OCR raw output for detection
        const pageTexts: string[] = [];
        for (let i = 0; i < pdf.pages.length; i++) {
          const ocrPage = ocrPages.find(op => op.pageIndex === i);
          if (ocrPage && ocrPage.text.length > 0) {
            pageTexts.push(ocrPage.text);
          } else {
            const pageInfo = pdf.pages[i];
            const originalPageText = pdf.text?.slice(pageInfo.textStart, pageInfo.textEnd) ?? '';
            pageTexts.push(originalPageText);
          }
        }

        const combined = pageTexts.join('\n\n');
        console.log(`[OCR] Combined text ready (${combined.length} chars). Re-running detection.`);
        setVisionText(combined);

        // Re-run regex on the OCR-improved text
        let regexEntities = detectWithRegex(combined);
        if (fileQueue.length > 1) {
          regexEntities = regexEntities.map(e => ({
            ...e,
            accepted: batchCategoryRules[e.category] ?? true,
          }));
        }
        setEntities(regexEntities);
        // Reset NER scanned ref so LLM re-scans with the better text
        nerScannedRef.current = null;
        // Start NER if not already loading (scanned PDFs skip NER initially since no text)
        ner.loadModel();
      });
    }
  }, [ocr.ready, pdf.isPDF, pdf.textQuality, appState, pdf.fileName]);

  // Phase 2: NER detection when model is ready and we have text to scan.
  // Track which text has been scanned to avoid duplicate runs.
  const nerScannedRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (ner.ready && detectionText && appState === 'review' && nerScannedRef.current !== detectionText) {
      nerScannedRef.current = detectionText;
      ner.detect(detectionText).then((nerEntities) => {
        setEntities((prev) => {
          // Merge NER entities, avoiding overlaps with regex entities
          const existing = new Set(prev.map((e) => `${e.start}-${e.end}`));
          let newEntities = nerEntities.filter(
            (e) => !existing.has(`${e.start}-${e.end}`),
          );
          // Apply batch category rules if in batch mode
          if (fileQueue.length > 1) {
            newEntities = newEntities.map(e => ({
              ...e,
              accepted: batchCategoryRules[e.category] ?? true,
            }));
          }
          return [...prev, ...newEntities].sort((a, b) => a.start - b.start);
        });
      });
    }
  }, [ner.ready, detectionText, appState]);

  const handleFileSelect = useCallback(
    (file: File) => {
      setAppState('scanning');
      setEntities([]);
      setRedactedText(null);
      setRedactedPdfBytes(null);
      setShowComparison(false);
      setVisionText(null);
      setOcrResults([]);
      nerScannedRef.current = null;
      visionScannedRef.current = null;
      pdf.parseFile(file);
    },
    [pdf],
  );

  const handleFilesSelect = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const queue: QueueItem[] = files.map((f, i) => ({
        file: f,
        status: i === 0 ? 'active' as const : 'pending' as const,
      }));
      setFileQueue(queue);
      setActiveQueueIdx(0);
      // Start processing the first file
      setAppState('scanning');
      setEntities([]);
      setRedactedText(null);
      setRedactedPdfBytes(null);
      setShowComparison(false);
      setVisionText(null);
      setOcrResults([]);
      nerScannedRef.current = null;
      visionScannedRef.current = null;
      pdf.parseFile(files[0]);
    },
    [pdf],
  );

  const advanceQueue = useCallback((markStatus: 'done' | 'skipped') => {
    // Save redacted bytes for current file if done
    const accepted = entities.filter(e => e.accepted).length;
    setFileQueue(prev => prev.map((item, i) => {
      if (i === activeQueueIdx) {
        return {
          ...item,
          status: markStatus,
          redactedBytes: markStatus === 'done' ? redactedPdfBytes ?? undefined : undefined,
          entityCount: markStatus === 'done' ? accepted : undefined,
        };
      }
      return item;
    }));

    // Find next pending file
    const nextIdx = fileQueue.findIndex((item, i) => i > activeQueueIdx && item.status === 'pending');
    if (nextIdx === -1) {
      // No more pending files — stay on current view so user can download from queue
      return;
    }

    setFileQueue(prev => prev.map((item, i) => {
      if (i === nextIdx) return { ...item, status: 'active' as const };
      return item;
    }));
    setActiveQueueIdx(nextIdx);
    setAppState('scanning');
    setEntities([]);
    setRedactedText(null);
    setRedactedPdfBytes(null);
    setShowComparison(false);
    setVisionText(null);
    setOcrResults([]);
    nerScannedRef.current = null;
    visionScannedRef.current = null;
    pdf.parseFile(fileQueue[nextIdx].file);
  }, [activeQueueIdx, fileQueue, entities, redactedPdfBytes, pdf]);

  const handleNextFile = useCallback(() => advanceQueue('done'), [advanceQueue]);
  const handleSkipFile = useCallback(() => advanceQueue('skipped'), [advanceQueue]);

  const handleDownloadQueueItem = useCallback((idx: number) => {
    const item = fileQueue[idx];
    if (!item?.redactedBytes) return;
    const blob = new Blob([item.redactedBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.file.name.replace(/\.pdf$/i, '_redacted.pdf');
    a.click();
    URL.revokeObjectURL(url);
  }, [fileQueue]);

  const handleTextPaste = useCallback(
    (text: string) => {
      setAppState('scanning');
      setEntities([]);
      setRedactedText(null);
      setRedactedPdfBytes(null);
      setVisionText(null);
      setOcrResults([]);
      visionScannedRef.current = null;
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

  const handleRedact = useCallback(async () => {
    if (!detectionText) return;

    if (pdf.isPDF) {
      const pdfDoc = pdf.getPDFDocument();
      if (!pdfDoc) return;
      setRedacting(true);
      setRedactProgress('Preparing...');
      try {
        const bytes = await createRedactedPDF(pdfDoc, entities, pdf.pages, (current, total) => {
          setRedactProgress(`Rendering page ${current}/${total}...`);
        }, ocrResults.length > 0 ? ocrResults : undefined);
        setRedactedPdfBytes(bytes);
        // Also produce text version for preview
        const result = redactText(detectionText, entities, redactStyle);
        setRedactedText(result);
        setAppState('redacted');
      } finally {
        setRedacting(false);
      }
    } else {
      const result = redactText(detectionText, entities, redactStyle);
      setRedactedText(result);
      setAppState('redacted');
    }
  }, [detectionText, pdf.isPDF, pdf.pages, entities, redactStyle]);

  const handleRedactAndNext = useCallback(async () => {
    if (!detectionText || !pdf.isPDF) return;
    const pdfDoc = pdf.getPDFDocument();
    if (!pdfDoc) return;

    setRedacting(true);
    setRedactProgress('Preparing...');
    try {
      const bytes = await createRedactedPDF(pdfDoc, entities, pdf.pages, (current, total) => {
        setRedactProgress(`Rendering page ${current}/${total}...`);
      });

      // Save to queue and advance
      const accepted = entities.filter(e => e.accepted).length;
      const nextIdx = fileQueue.findIndex((item, i) => i > activeQueueIdx && item.status === 'pending');

      setFileQueue(prev => prev.map((item, i) => {
        if (i === activeQueueIdx) {
          return { ...item, status: 'done' as const, redactedBytes: bytes, entityCount: accepted };
        }
        if (i === nextIdx) return { ...item, status: 'active' as const };
        return item;
      }));

      if (nextIdx === -1) {
        // Last file — show redacted state
        setRedactedPdfBytes(bytes);
        const result = redactText(detectionText, entities, redactStyle);
        setRedactedText(result);
        setAppState('redacted');
      } else {
        // Advance to next file
        setActiveQueueIdx(nextIdx);
        setAppState('scanning');
        setEntities([]);
        setRedactedText(null);
        setRedactedPdfBytes(null);
        setShowComparison(false);
        setVisionText(null);
        setOcrResults([]);
        nerScannedRef.current = null;
        visionScannedRef.current = null;
        pdf.parseFile(fileQueue[nextIdx].file);
      }
    } finally {
      setRedacting(false);
    }
  }, [detectionText, pdf.isPDF, pdf.pages, entities, redactStyle, fileQueue, activeQueueIdx, pdf]);

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

  const handleDownloadReport = useCallback(() => {
    const report = generateRedactionReport(entities, pdf.fileName || undefined);
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pdf.fileName
      ? pdf.fileName.replace(/\.pdf$/i, '_redaction_report.txt')
      : 'redaction_report.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [entities, pdf.fileName]);

  const handleStartOver = useCallback(() => {
    setAppState('input');
    setEntities([]);
    setRedactedText(null);
    setRedactedPdfBytes(null);
    setFileQueue([]);
    setActiveQueueIdx(-1);
    setBatchCategoryRules(defaultCategoryRules());
    setShowComparison(false);
    setVisionText(null);
    setOcrResults([]);
    nerScannedRef.current = null;
    visionScannedRef.current = null;
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
          <svg width="32" height="32" viewBox="0 0 32 32" className="flex-shrink-0">
            <defs>
              <linearGradient id="logo-g" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--accent-primary)" />
                <stop offset="100%" stopColor="#5B3FD4" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="8" fill="url(#logo-g)" />
            <rect x="7" y="8" width="18" height="3" rx="1.5" fill="white" opacity="0.9" />
            <rect x="7" y="14" width="14" height="3" rx="1.5" fill="white" opacity="0.9" />
            <rect x="7" y="20" width="10" height="3" rx="1.5" fill="#1a1a2e" />
            <rect x="19" y="20" width="6" height="3" rx="1.5" fill="#1a1a2e" />
          </svg>
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
        {/* Batch queue progress */}
        {fileQueue.length > 1 && (
          <div
            className="mb-6 rounded-xl p-4"
            style={{ background: 'var(--bg-soft)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Files size={16} style={{ color: 'var(--accent-primary)' }} />
              <span
                className="text-sm font-semibold"
                style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: 'var(--ink-primary)' }}
              >
                Batch Processing
              </span>
              <span className="text-xs ml-auto" style={{ color: 'var(--ink-tertiary)' }}>
                {fileQueue.filter(q => q.status === 'done').length}/{fileQueue.length} complete
              </span>
            </div>
            <div className="space-y-1.5">
              {fileQueue.map((item, i) => {
                // Compute per-file progress for active item
                const isActive = item.status === 'active';
                let activePhase = '';
                let activePercent = 0;
                if (isActive) {
                  if (pdf.loading) {
                    activePhase = 'Parsing...';
                    activePercent = 10;
                  } else if (appState === 'scanning') {
                    activePhase = 'Detecting...';
                    activePercent = 20;
                  } else if (ocr.loading) {
                    activePhase = 'Loading OCR engine...';
                    activePercent = 15;
                  } else if (ocr.extractionProgress) {
                    const vPct = ocr.extractionProgress.current / ocr.extractionProgress.total;
                    activePhase = `OCR scanning page ${ocr.extractionProgress.current}/${ocr.extractionProgress.total}`;
                    activePercent = 25 + Math.round(vPct * 15);
                  } else if (ner.loading) {
                    activePhase = `Loading AI model ${ner.progress}%`;
                    activePercent = 20 + Math.round(ner.progress * 0.3);
                  } else if (ner.inferenceProgress) {
                    const chunkPct = ner.inferenceProgress.current / ner.inferenceProgress.total;
                    activePhase = `AI scanning chunk ${ner.inferenceProgress.current}/${ner.inferenceProgress.total}`;
                    activePercent = 50 + Math.round(chunkPct * 30);
                  } else if (redacting) {
                    activePhase = redactProgress || 'Redacting...';
                    activePercent = 85;
                  } else if (appState === 'review') {
                    activePhase = `${entities.length} entities found — ready to redact`;
                    activePercent = 80;
                  } else if (appState === 'redacted') {
                    activePhase = 'Redacted — ready to download';
                    activePercent = 100;
                  }
                }

                return (
                  <div key={i}>
                    <div
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
                      style={{
                        background: isActive ? 'var(--accent-primary-soft)' : 'var(--bg-base)',
                        border: isActive ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                        borderRadius: isActive && activePhase ? '8px 8px 0 0' : undefined,
                      }}
                    >
                      {item.status === 'done' && <Check size={12} style={{ color: 'var(--accent-primary)' }} />}
                      {isActive && (() => {
                        const isWorking = pdf.loading || appState === 'scanning' || ner.loading || !!ner.inferenceProgress || ocr.loading || !!ocr.extractionProgress || redacting;
                        return <Loader2 size={12} className={isWorking ? 'animate-spin' : ''} style={{ color: 'var(--accent-primary)' }} />;
                      })()}
                      {item.status === 'skipped' && <SkipForward size={12} style={{ color: 'var(--ink-faint)' }} />}
                      {item.status === 'pending' && <div className="w-3 h-3 rounded-full" style={{ border: '1px solid var(--border-default)' }} />}
                      <span
                        className="flex-1 truncate"
                        style={{ color: item.status === 'done' || item.status === 'skipped' ? 'var(--ink-faint)' : 'var(--ink-secondary)' }}
                      >
                        {item.file.name}
                      </span>
                      {item.status === 'done' && item.entityCount !== undefined && (
                        <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                          {item.entityCount} redacted
                        </span>
                      )}
                      {item.status === 'skipped' && (
                        <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>skipped</span>
                      )}
                      {item.status === 'done' && item.redactedBytes && (
                        <button
                          onClick={() => handleDownloadQueueItem(i)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors"
                          style={{ color: 'var(--accent-primary)', background: 'var(--accent-primary-soft)' }}
                        >
                          <Download size={10} />
                          Download
                        </button>
                      )}
                    </div>
                    {/* Per-file progress bar for active item */}
                    {isActive && activePhase && (
                      <div
                        className="px-3 pb-2 pt-1 rounded-b-lg"
                        style={{
                          background: 'var(--accent-primary-soft)',
                          borderLeft: '1px solid var(--accent-primary)',
                          borderRight: '1px solid var(--accent-primary)',
                          borderBottom: '1px solid var(--accent-primary)',
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs" style={{ color: 'var(--ink-tertiary)' }}>{activePhase}</span>
                        </div>
                        <div
                          className="h-1 rounded-full overflow-hidden"
                          style={{ background: 'var(--bg-elevated)' }}
                        >
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${activePercent}%`, background: 'var(--accent-primary)' }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Progress bar */}
            <div
              className="h-1.5 rounded-full overflow-hidden mt-3"
              style={{ background: 'var(--bg-elevated)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.round((fileQueue.filter(q => q.status === 'done' || q.status === 'skipped').length / fileQueue.length) * 100)}%`,
                  background: 'var(--accent-primary)',
                }}
              />
            </div>
            {/* Batch category rules */}
            <div className="mt-3">
              <p className="text-xs font-medium mb-2" style={{ color: 'var(--ink-tertiary)' }}>
                Auto-redact categories (applied to each new file):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ALL_CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setBatchCategoryRules(prev => ({ ...prev, [cat]: !prev[cat] }))}
                    className="px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                    style={{
                      background: batchCategoryRules[cat]
                        ? `var(${ENTITY_CONFIG[cat].softVar})`
                        : 'var(--bg-base)',
                      color: batchCategoryRules[cat]
                        ? `var(${ENTITY_CONFIG[cat].colorVar})`
                        : 'var(--ink-faint)',
                      border: batchCategoryRules[cat]
                        ? `1px solid var(${ENTITY_CONFIG[cat].colorVar})`
                        : '1px solid var(--border-subtle)',
                      opacity: batchCategoryRules[cat] ? 1 : 0.6,
                    }}
                  >
                    {ENTITY_CONFIG[cat].label}
                  </button>
                ))}
              </div>
            </div>
            {/* Download all button when batch is complete */}
            {fileQueue.every(q => q.status === 'done' || q.status === 'skipped') && (
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => fileQueue.forEach((_, i) => handleDownloadQueueItem(i))}
                  className="btn-primary text-xs h-8 px-4 flex items-center gap-1.5"
                >
                  <Download size={14} />
                  Download All ({fileQueue.filter(q => q.redactedBytes).length} files)
                </button>
                <button
                  onClick={handleStartOver}
                  className="btn-secondary text-xs h-8 px-4"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        )}

        {/* Input state */}
        {appState === 'input' && (
          <div className="flex flex-col items-center gap-10">
            {/* Hero */}
            <div className="text-center max-w-2xl">
              <h2
                className="text-4xl font-bold mb-4 leading-tight"
                style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: 'var(--ink-primary)' }}
              >
                Redact sensitive data.<br />
                <span style={{ color: 'var(--accent-primary)' }}>Entirely in your browser.</span>
              </h2>
              <p className="text-base mb-8" style={{ color: 'var(--ink-secondary)' }}>
                Edge AI redaction — the model runs on your device, not in the cloud.
                No uploads. No servers. Your document never leaves your browser.
              </p>

              {/* Differentiators */}
              <div className="flex flex-wrap justify-center gap-6 mb-2">
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-tertiary)' }}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-primary-soft)' }}>
                    <Lock size={14} style={{ color: 'var(--accent-primary)' }} />
                  </div>
                  <span>Zero data uploaded</span>
                </div>
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-tertiary)' }}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-primary-soft)' }}>
                    <Cpu size={14} style={{ color: 'var(--accent-primary)' }} />
                  </div>
                  <span>Edge AI — runs on your GPU</span>
                </div>
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-tertiary)' }}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-primary-soft)' }}>
                    <Eye size={14} style={{ color: 'var(--accent-primary)' }} />
                  </div>
                  <span>OCR for scanned docs</span>
                </div>
              </div>
            </div>

            {/* Mobile gate */}
            {typeof window !== 'undefined' && window.innerWidth <= 768 && (
              <div
                className="w-full max-w-md mx-auto rounded-2xl p-6 text-center"
                style={{ background: 'var(--warning-soft)', border: '1px solid var(--warning)' }}
              >
                <Smartphone size={24} className="mx-auto mb-3" style={{ color: 'var(--warning)' }} />
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--warning)' }}>
                  Desktop browser required
                </p>
                <p className="text-xs" style={{ color: 'var(--ink-tertiary)' }}>
                  LocalRedact uses a 2.5GB AI model that requires a desktop GPU.
                  Open this page on a laptop or desktop with Chrome, Edge, or Safari.
                </p>
              </div>
            )}

            <DropZone
              onFileSelect={handleFileSelect}
              onFilesSelect={handleFilesSelect}
              onTextPaste={handleTextPaste}
              loading={pdf.loading}
            />

            {/* How it works */}
            <div className="w-full max-w-2xl">
              <div className="flex justify-between gap-4">
                {[
                  { step: '1', title: 'Drop', desc: 'Upload a PDF or paste text' },
                  { step: '2', title: 'Detect', desc: 'AI finds names, SSNs, addresses' },
                  { step: '3', title: 'Redact', desc: 'Black boxes destroy the original' },
                ].map((item) => (
                  <div key={item.step} className="flex-1 text-center">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center mx-auto mb-2 text-xs font-bold"
                      style={{ background: 'var(--accent-primary-soft)', color: 'var(--accent-primary)' }}
                    >
                      {item.step}
                    </div>
                    <p className="text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>{item.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--ink-tertiary)' }}>{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
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
        {appState === 'review' && (detectionText || (pdf.isPDF && pdf.pages.length > 0)) && (
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
                      First load ~30s, cached after (~2.5GB)
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
                      Downloading{' '}
                      <a
                        href="https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                        style={{ color: 'var(--ink-tertiary)' }}
                      >
                        Qwen3-4B
                      </a>
                      {' '}(Apache 2.0) via WebGPU. Runs locally, never sent to a server.
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

              {/* OCR loading indicator */}
              {ocr.loading && (
                <div
                  className="glass-panel rounded-2xl overflow-hidden px-5 py-3 flex items-center gap-4"
                >
                  <Loader2
                    size={16}
                    className="animate-spin flex-shrink-0"
                    style={{ color: 'var(--accent-primary)' }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
                      Loading OCR engine...
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--ink-faint)' }}>
                      Poor text extraction detected. Using Tesseract OCR for better results.
                    </p>
                  </div>
                </div>
              )}

              {/* OCR extraction progress */}
              {!ocr.loading && ocr.extractionProgress && (
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
                        OCR scanning pages
                      </span>
                      <span className="text-xs font-medium" style={{ color: 'var(--ink-primary)' }}>
                        Page {ocr.extractionProgress.current} of {ocr.extractionProgress.total}
                      </span>
                    </div>
                    <div
                      className="h-1.5 rounded-full overflow-hidden"
                      style={{ background: 'var(--bg-elevated)' }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.round((ocr.extractionProgress.current / ocr.extractionProgress.total) * 100)}%`,
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
                  ocrResults={ocrResults}
                />
              ) : (
                <DocumentViewer
                  text={detectionText || ''}
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
              {fileQueue.length > 1 && (
                <div className="space-y-2 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <button
                    onClick={handleRedactAndNext}
                    disabled={acceptedCount === 0 || redacting}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                    style={{ opacity: acceptedCount > 0 && !redacting ? 1 : 0.5 }}
                  >
                    {redacting ? (
                      <><Loader2 size={16} className="animate-spin" />{redactProgress || 'Redacting...'}</>
                    ) : (
                      <><ChevronRight size={16} />Redact & Next File</>
                    )}
                  </button>
                  {fileQueue.some((q, i) => i > activeQueueIdx && q.status === 'pending') && (
                    <button
                      onClick={handleSkipFile}
                      className="btn-secondary w-full flex items-center justify-center gap-2 text-xs"
                    >
                      <SkipForward size={14} />
                      Skip this file
                    </button>
                  )}
                </div>
              )}
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
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <button
                      onClick={() => setShowComparison((v) => !v)}
                      className="btn-secondary text-xs h-8 px-3"
                      title={showComparison ? 'Show redacted only' : 'Compare before/after'}
                    >
                      {showComparison ? <FileText size={14} /> : <Columns2 size={14} />}
                      {showComparison ? 'Redacted Only' : 'Compare'}
                    </button>
                  </div>
                  {showComparison ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-xs font-medium" style={{ color: 'var(--ink-tertiary)' }}>Original</span>
                        <PDFPageViewer
                          pdfDoc={pdf.getPDFDocument()!}
                          pages={pdf.pages}
                          entities={entities}
                          mode="review"
                          onEntityClick={handleToggleEntity}
                          ocrResults={ocrResults}
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-medium" style={{ color: 'var(--ink-tertiary)' }}>Redacted</span>
                        <PDFPageViewer
                          pdfDoc={pdf.getPDFDocument()!}
                          pages={pdf.pages}
                          entities={entities}
                          mode="redacted"
                          onEntityClick={handleToggleEntity}
                          ocrResults={ocrResults}
                        />
                      </div>
                    </div>
                  ) : (
                    <PDFPageViewer
                      pdfDoc={pdf.getPDFDocument()!}
                      pages={pdf.pages}
                      entities={entities}
                      mode="redacted"
                      onEntityClick={handleToggleEntity}
                      ocrResults={ocrResults}
                    />
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <button
                      onClick={() => setShowComparison((v) => !v)}
                      className="btn-secondary text-xs h-8 px-3"
                      title={showComparison ? 'Show redacted only' : 'Compare before/after'}
                    >
                      {showComparison ? <FileText size={14} /> : <Columns2 size={14} />}
                      {showComparison ? 'Redacted Only' : 'Compare'}
                    </button>
                  </div>
                  {showComparison ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-xs font-medium" style={{ color: 'var(--ink-tertiary)' }}>Original</span>
                        <DocumentViewer
                          text={detectionText || ''}
                          entities={entities}
                          onEntityClick={handleToggleEntity}
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-medium" style={{ color: 'var(--ink-tertiary)' }}>Redacted</span>
                        <div className="glass-panel rounded-2xl p-6 overflow-auto max-h-[60vh]">
                          <div
                            className="text-sm leading-relaxed whitespace-pre-wrap font-mono"
                            style={{ color: 'var(--ink-primary)' }}
                          >
                            {redactedText}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="glass-panel rounded-2xl p-6 overflow-auto max-h-[60vh]">
                      <div
                        className="text-sm leading-relaxed whitespace-pre-wrap font-mono"
                        style={{ color: 'var(--ink-primary)' }}
                      >
                        {redactedText}
                      </div>
                    </div>
                  )}
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
                onDownloadReport={handleDownloadReport}
                redacted={true}
                isPDF={pdf.isPDF}
              />
              {fileQueue.length > 1 && fileQueue.some((q, i) => i > activeQueueIdx && q.status === 'pending') && (
                <div className="space-y-2">
                  <button
                    onClick={handleNextFile}
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    <ChevronRight size={16} />
                    Next File
                  </button>
                </div>
              )}
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

        {ocr.error && pdf.textQuality?.needsVision && (
          <div
            className="mt-4 p-4 rounded-xl text-sm"
            style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}
          >
            OCR fallback unavailable: {ocr.error}. Using text extraction only.
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center py-8 space-y-1">
        <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          100% client-side. Zero data leaves your browser.
        </p>
        <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          Powered by{' '}
          <a href="https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" style={{ color: 'var(--ink-tertiary)' }}>Qwen3-4B</a>
          {' '}&middot;{' '}
          <a href="https://github.com/naptha/tesseract.js" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" style={{ color: 'var(--ink-tertiary)' }}>Tesseract.js</a>
          {' '}&middot;{' '}
          <a href="https://github.com/mlc-ai/web-llm" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" style={{ color: 'var(--ink-tertiary)' }}>WebLLM</a>
        </p>
        <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          Built by{' '}
          <a
            href="https://mmostagirbhuiyan.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:opacity-80 transition-opacity"
            style={{ color: 'var(--ink-secondary)' }}
          >
            Mostagir Bhuiyan
          </a>
        </p>
      </footer>
    </div>
  );
};

export default App;
