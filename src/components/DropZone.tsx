import React, { useState, useCallback, useRef } from 'react';
import { Upload, FileText, Type } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface DropZoneProps {
  onFileSelect: (file: File) => void;
  onFilesSelect?: (files: File[]) => void;
  onTextPaste: (text: string) => void;
  loading: boolean;
}

export const DropZone: React.FC<DropZoneProps> = ({ onFileSelect, onFilesSelect, onTextPaste, loading }) => {
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState<'drop' | 'paste'>('drop');
  const [pasteText, setPasteText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.type === 'application/pdf',
      );
      if (files.length > 1 && onFilesSelect) {
        onFilesSelect(files);
      } else if (files.length === 1) {
        onFileSelect(files[0]);
      }
    },
    [onFileSelect, onFilesSelect],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (files.length > 1 && onFilesSelect) {
        onFilesSelect(files);
      } else if (files.length === 1) {
        onFileSelect(files[0]);
      }
    },
    [onFileSelect, onFilesSelect],
  );

  const handlePasteSubmit = useCallback(() => {
    if (pasteText.trim()) {
      onTextPaste(pasteText.trim());
    }
  }, [pasteText, onTextPaste]);

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Mode toggle */}
      <div
        className="flex items-center gap-1 p-1 rounded-full mx-auto w-fit mb-6"
        style={{ background: 'var(--bg-soft)', border: '1px solid var(--border-subtle)' }}
      >
        <button
          onClick={() => setMode('drop')}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200"
          style={{
            background: mode === 'drop' ? 'var(--bg-elevated)' : 'transparent',
            color: mode === 'drop' ? 'var(--ink-primary)' : 'var(--ink-tertiary)',
            boxShadow: mode === 'drop' ? 'var(--shadow-sm)' : 'none',
          }}
        >
          <FileText size={14} />
          Drop PDF
        </button>
        <button
          onClick={() => setMode('paste')}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200"
          style={{
            background: mode === 'paste' ? 'var(--bg-elevated)' : 'transparent',
            color: mode === 'paste' ? 'var(--ink-primary)' : 'var(--ink-tertiary)',
            boxShadow: mode === 'paste' ? 'var(--shadow-sm)' : 'none',
          }}
        >
          <Type size={14} />
          Paste Text
        </button>
      </div>

      <AnimatePresence mode="wait">
        {mode === 'drop' ? (
          <motion.div
            key="drop"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="glass-panel cursor-pointer rounded-2xl p-12 text-center transition-all duration-300"
              style={{
                borderColor: dragOver ? 'var(--accent-primary)' : undefined,
                boxShadow: dragOver ? '0 0 40px var(--accent-primary-glow)' : undefined,
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                multiple
                onChange={handleFileInput}
                className="hidden"
              />
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ background: 'var(--accent-primary-soft)' }}
              >
                <Upload size={28} style={{ color: 'var(--accent-primary)' }} />
              </div>
              <p className="text-lg font-medium mb-2" style={{ color: 'var(--ink-primary)' }}>
                {loading ? 'Parsing PDF...' : 'Drop PDFs here'}
              </p>
              <p className="text-sm" style={{ color: 'var(--ink-tertiary)' }}>
                or click to browse. Drop multiple files for batch processing.
              </p>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="paste"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <div className="glass-panel rounded-2xl p-6">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste your text here..."
                rows={8}
                className="w-full rounded-xl p-4 text-sm resize-none focus:outline-none"
                style={{
                  background: 'var(--bg-input)',
                  color: 'var(--ink-primary)',
                  border: '1px solid var(--border-default)',
                }}
              />
              <button
                onClick={handlePasteSubmit}
                disabled={!pasteText.trim()}
                className="btn-primary mt-4 w-full"
                style={{ opacity: pasteText.trim() ? 1 : 0.5 }}
              >
                Scan for PII
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
