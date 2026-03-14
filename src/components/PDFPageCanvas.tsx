import React, { useEffect, useRef, useMemo } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PDFPageInfo } from '../hooks/usePDFParser';
import { DetectedEntity, ENTITY_CONFIG } from '../lib/entity-types';
import { getPageEntityOverlays, type EntityOverlay } from '../lib/pdf-redactor';
import type { OCRWord } from '../hooks/useOCR';

interface PDFPageCanvasProps {
  pdfDoc: PDFDocumentProxy;
  pageIndex: number;
  pageInfo: PDFPageInfo;
  entities: DetectedEntity[];
  scale: number;
  mode: 'review' | 'redacted';
  focusedEntityId?: string | null;
  onEntityClick: (id: string) => void;
  ocrWords?: OCRWord[];
}

export const PDFPageCanvas: React.FC<PDFPageCanvasProps> = ({
  pdfDoc,
  pageIndex,
  pageInfo,
  entities,
  scale,
  mode,
  focusedEntityId,
  onEntityClick,
  ocrWords,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const displayWidth = Math.round(pageInfo.width * scale);
  const displayHeight = Math.round(pageInfo.height * scale);

  // Render the PDF page to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    (async () => {
      // Cancel any in-flight render
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const page = await pdfDoc.getPage(pageIndex + 1);

      // Use 2x for sharpness on retina, capped to avoid memory issues
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const renderScale = scale * dpr;
      const viewport = page.getViewport({ scale: renderScale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;

      const ctx = canvas.getContext('2d')!;

      if (cancelled) return;

      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;

      try {
        await task.promise;
      } catch {
        // Render was cancelled or failed
        return;
      }

      if (cancelled) return;
      renderTaskRef.current = null;

      // In redacted mode, draw solid black boxes for accepted entities
      if (mode === 'redacted') {
        const overlays = getPageEntityOverlays(
          entities.filter((e) => e.accepted),
          pageInfo,
          ocrWords,
        );
        ctx.fillStyle = '#000000';
        for (const overlay of overlays) {
          for (const box of overlay.boxes) {
            ctx.fillRect(
              box.x * renderScale,
              box.y * renderScale,
              box.width * renderScale,
              box.height * renderScale,
            );
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdfDoc, pageIndex, scale, mode, entities, pageInfo, displayWidth, displayHeight, ocrWords]);

  // Compute overlays for review mode
  const overlays: EntityOverlay[] = useMemo(() => {
    if (mode !== 'review') return [];
    return getPageEntityOverlays(entities, pageInfo, ocrWords);
  }, [mode, entities, pageInfo, ocrWords]);

  return (
    <div
      className="relative inline-block"
      style={{ width: displayWidth, height: displayHeight }}
    >
      <canvas ref={canvasRef} />

      {/* Review mode: semi-transparent overlays */}
      {mode === 'review' &&
        overlays.map((overlay) => {
          const config = ENTITY_CONFIG[overlay.entity.category];
          const accepted = overlay.entity.accepted;
          const focused = focusedEntityId === overlay.entityId;

          return overlay.boxes.map((box, boxIdx) => (
            <div
              key={`${overlay.entityId}-${boxIdx}`}
              onClick={() => onEntityClick(overlay.entityId)}
              className="absolute cursor-pointer transition-opacity duration-150"
              style={{
                left: box.x * scale,
                top: box.y * scale,
                width: box.width * scale,
                height: box.height * scale,
                background: accepted
                  ? `var(${config.softVar})`
                  : 'transparent',
                border: `2px solid var(${config.colorVar})`,
                opacity: accepted ? 0.8 : 0.3,
                outline: focused
                  ? `3px solid var(${config.colorVar})`
                  : 'none',
                outlineOffset: '2px',
                borderRadius: '2px',
              }}
              title={`${config.label}: ${overlay.entity.text}${accepted ? '' : ' (rejected)'}`}
            />
          ));
        })}
    </div>
  );
};
