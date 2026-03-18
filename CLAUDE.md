# LocalRedact

## Critical Rules
1. NO backend calls. NO fetch to external APIs. Everything runs in the browser.
2. NO slop — no emojis in code/logs, no AI-isms, no over-engineering
3. Match existing patterns — search before creating new ones
4. Regex results MUST appear before NER model loads (two-phase UX)
5. Test on mobile viewport before marking any UI task done
6. Update Session State at END of each session

## Architecture
React SPA. Two-phase PII detection: regex (instant) + WebLLM LLM (lazy-loaded, WebGPU).
LLM outputs structured JSON — no BIO tagging, no subword merging, no token classification.
PDF text extraction via pdfjs-dist with Tesseract.js OCR fallback for scanned/image-only PDFs.
True PDF redaction via render-to-image pipeline (pdfjs canvas → black boxes → pdf-lib image-only PDF).
Hosted on Cloudflare Pages (static). See ROADMAP.md for full v2 implementation plan.

## Tech Stack
Vite | React 18 | TypeScript | Tailwind CSS v4 (PostCSS) | @mlc-ai/web-llm (WebGPU LLM inference)
pdfjs-dist | pdf-lib | tesseract.js | lucide-react | framer-motion
Active model: Qwen3-4B-q4f16_1-MLC (PII extraction, ~2.5GB, WebGPU). Tesseract.js (OCR fallback, WASM+WebWorker)

## Commands
- `npm run dev` — Start dev server
- `npm run build` — Production build
- `npm run preview` — Preview production build

## Entity Types
| Category | Color | CSS Var |
|----------|-------|---------|
| PERSON | Red | --pii-person |
| ORGANIZATION | Blue | --pii-org |
| LOCATION | Green | --pii-location |
| ADDRESS | Amber | --pii-address |
| SSN / CREDIT_CARD | Orange | --pii-ssn-cc |
| EMAIL / PHONE | Purple | --pii-email-phone |
| DATE | Teal | --pii-date |

## Key Files
| File | Purpose |
|------|---------|
| src/App.tsx | Main app, state machine (input→scanning→review→redacted) |
| src/lib/regex-patterns.ts | Instant regex PII detection (SSN, CC, email, phone, date, address) |
| src/lib/entity-types.ts | Entity category definitions + color config |
| src/lib/redactor.ts | Text replacement logic ([REDACTED] or black blocks) |
| src/hooks/useNERModel.ts | WebLLM model loading + PII inference + timing |
| src/lib/pii-prompt.ts | System prompt for structured PII extraction via LLM |
| src/lib/pdf-redactor.ts | Render-to-image PDF redaction + coordinate mapping (text + OCR) |
| src/hooks/useOCR.ts | Tesseract.js OCR for scanned PDFs (word-level bboxes) |
| src/hooks/usePDFParser.ts | pdfjs-dist text extraction + page info + PDF doc ref |
| src/components/PDFPageViewer.tsx | Multi-page PDF viewer with zoom, lazy loading |
| src/components/PDFPageCanvas.tsx | Single PDF page canvas + clickable entity overlays |
| src/lib/redaction-report.ts | Plain text redaction report generator |
| src/lib/__tests__/pdf-hex-verify.test.ts | Hex verification unit tests |
| src/components/DropZone.tsx | Multi-file drag-and-drop + text paste input |
| src/components/DocumentViewer.tsx | Highlighted text with PII annotations (text-only mode) |
| src/components/DevViewer.tsx | AI transparency panel (prompt/response/parsed entities) |
| src/components/EntityList.tsx | Sidebar list of detected entities |
| src/components/RedactControls.tsx | Accept/reject/redact-all controls + undo/redo buttons |
| src/components/ShareCard.tsx | Post-redaction card with entity count + performance metrics |
| src/hooks/useWebGPU.ts | WebGPU availability detection (available/unavailable/mobile) |
| src/hooks/useUndoRedo.ts | Undo/redo stack for entity accept/reject actions |
| src/contexts/ThemeContext.tsx | Dark/light/system theme (localStorage: lr-theme) |

## Design System
Adapted from Meridian. CSS variables in src/index.css. Glass morphism panels.
Fonts: Space Grotesk (headings), Outfit (body). Dark-first, light mode supported.

## Slash Commands
| Command | Purpose |
|---------|---------|
| /sprint | Execute next ROADMAP.md task (one at a time, verify, approve, commit) |
| /feature | Implement new feature |
| /fix | Fix a bug |
| /explore | Explore codebase |
| /release | Cut a release |
| /test | Write tests |

### Sprint Usage
```
/sprint              # Pick up next unchecked task
/sprint Phase 1      # Work on Phase 1 specifically
/sprint 2.1          # Work on Phase 2, section 1
/sprint --status     # Show progress across all phases
/sprint --next       # Preview next task without starting
```

## Dead Approaches
Do NOT retry these — each was tested and failed:
- **PDF content stream surgery** (pdf-lib) — too many edge cases, one miss = data leak. Render-to-image is correct.
- **Token classification** (bert-base-NER, Piiranha/DeBERTa) — BIO tagging + subword merging is fragile. LLM + structured JSON is better.
- **gemma-2-2b-it** — empty results on dense content. Replaced by Qwen3-4B.
- **Llama 3.2** — safety alignment refuses to extract PII.
- **SmolVLM-256M** for OCR — no bounding boxes, too small. Replaced by Tesseract.js.
- **Confidence field in LLM prompt** — distracted Qwen3-4B, missed entities. Compute from match quality instead.
- **Example entities in prompt** — causes hallucination across documents.
- **Otsu binarization** — too aggressive on watermarked docs. Use gamma contrast.
- **preserve_interword_spaces** (Tesseract) — doubles word count, breaks matching.

## Current State
Last Updated: 2026-03-18 | Session 11 | All phases complete.

**Flows:**
- PDF: upload → regex (instant) → LLM (chunked) → review with overlays → redact (render-to-image) → download
- Scanned PDF: same, with Tesseract.js OCR fallback for image-only pages
- Text: paste → detect → redact → download
- Batch: multi-file drop → per-file queue → category rules → Redact & Next File → Download All

**Model config:** Qwen3-4B-q4f16_1-MLC (~2.5GB, cached). Temp 0, max_tokens 1024, /no_think.
**Confidence:** computed from match quality (exact=0.95, fuzzy=0.80, regex=1.0), not LLM output.
**Known issues:** LLM occasionally non-deterministic on chunk count. OCR limited on heavy holographic overlays.

## Development Log

| Session | Date | Summary |
|---------|------|---------|
| 2-5 | 2026-03-10 | Core pipeline: regex + WebLLM detection, render-to-image PDF redaction, PDF viewer with entity overlays, keyboard shortcuts |
| 6 | 2026-03-10 | Switched to Qwen3-4B, fuzzy text matching, chunk overlap |
| 7 | 2026-03-10 | Fixed concurrent detection race condition, inference progress bar, entity dedup |
| 8 | 2026-03-11 | Hex verification, entity editing, confidence scores, redaction report, comparison view |
| 9 | 2026-03-11 | Batch processing (multi-file, category rules, queue), fixed confidence prompt regression |
| 10 | 2026-03-14 | Tesseract.js OCR fallback, edit-distance matching, auto-rotation for sideways scans |
| 11 | 2026-03-18 | WebGPU capability gate, performance metrics, undo/redo, ADDRESS entity type |
