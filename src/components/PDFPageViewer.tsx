import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PDFPageInfo } from '../hooks/usePDFParser';
import type { DetectedEntity } from '../lib/entity-types';
import { PDFPageCanvas } from './PDFPageCanvas';

interface PDFPageViewerProps {
  pdfDoc: PDFDocumentProxy;
  pages: PDFPageInfo[];
  entities: DetectedEntity[];
  mode: 'review' | 'redacted';
  focusedEntityId?: string | null;
  onEntityClick: (id: string) => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;
const SCALE_STEP = 0.25;
const DEFAULT_SCALE = 1.0;

export const PDFPageViewer: React.FC<PDFPageViewerProps> = ({
  pdfDoc,
  pages,
  entities,
  mode,
  focusedEntityId,
  onEntityClick,
}) => {
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([0, 1]));

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(s + SCALE_STEP, MAX_SCALE));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(s - SCALE_STEP, MIN_SCALE));
  }, []);

  // Lazy rendering: track which pages are visible
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const idx = Number(entry.target.getAttribute('data-page-index'));
            if (entry.isIntersecting) {
              next.add(idx);
              // Buffer: also render adjacent pages
              if (idx > 0) next.add(idx - 1);
              if (idx < pages.length - 1) next.add(idx + 1);
            }
          }
          return next;
        });
      },
      {
        root: containerRef.current,
        rootMargin: '200px 0px',
        threshold: 0,
      },
    );

    for (const [, el] of pageRefs.current) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [pages.length, scale]);

  // Scroll to focused entity's page
  useEffect(() => {
    if (!focusedEntityId) return;
    const entity = entities.find((e) => e.id === focusedEntityId);
    if (!entity) return;

    const pageIdx = pages.findIndex(
      (p) => entity.start < p.textEnd && entity.end > p.textStart,
    );
    if (pageIdx === -1) return;

    const el = pageRefs.current.get(pageIdx);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [focusedEntityId, entities, pages]);

  const setPageRef = useCallback((idx: number, el: HTMLDivElement | null) => {
    if (el) {
      pageRefs.current.set(idx, el);
    } else {
      pageRefs.current.delete(idx);
    }
  }, []);

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      {/* Zoom controls */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span className="text-xs font-medium" style={{ color: 'var(--ink-tertiary)' }}>
          {pages.length} page{pages.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={zoomOut}
            disabled={scale <= MIN_SCALE}
            className="p-1.5 rounded-lg transition-colors"
            style={{
              color: scale <= MIN_SCALE ? 'var(--ink-faint)' : 'var(--ink-secondary)',
              background: 'var(--bg-soft)',
            }}
          >
            <ZoomOut size={14} />
          </button>
          <span className="text-xs font-mono w-10 text-center" style={{ color: 'var(--ink-secondary)' }}>
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            disabled={scale >= MAX_SCALE}
            className="p-1.5 rounded-lg transition-colors"
            style={{
              color: scale >= MAX_SCALE ? 'var(--ink-faint)' : 'var(--ink-secondary)',
              background: 'var(--bg-soft)',
            }}
          >
            <ZoomIn size={14} />
          </button>
        </div>
      </div>

      {/* Pages */}
      <div
        ref={containerRef}
        className="overflow-auto p-4 space-y-4"
        style={{ maxHeight: '70vh', background: 'var(--bg-soft)' }}
      >
        {pages.map((page) => (
          <div
            key={page.pageIndex}
            ref={(el) => setPageRef(page.pageIndex, el)}
            data-page-index={page.pageIndex}
            className="flex flex-col items-center"
          >
            {visiblePages.has(page.pageIndex) ? (
              <PDFPageCanvas
                pdfDoc={pdfDoc}
                pageIndex={page.pageIndex}
                pageInfo={page}
                entities={entities}
                scale={scale}
                mode={mode}
                focusedEntityId={focusedEntityId}
                onEntityClick={onEntityClick}
              />
            ) : (
              // Placeholder for off-screen pages
              <div
                style={{
                  width: Math.round(page.width * scale),
                  height: Math.round(page.height * scale),
                  background: 'var(--bg-elevated)',
                  borderRadius: '4px',
                }}
              />
            )}
            <span
              className="text-xs mt-1"
              style={{ color: 'var(--ink-faint)' }}
            >
              Page {page.pageIndex + 1}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
