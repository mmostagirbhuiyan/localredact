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
PDF text extraction via pdfjs-dist with SmolVLM vision fallback for problematic PDFs.
True PDF redaction via render-to-image pipeline (pdfjs canvas → black boxes → pdf-lib image-only PDF).
Hosted on Cloudflare Pages (static). See ROADMAP.md for full v2 implementation plan.

## Tech Stack
Vite | React 18 | TypeScript | Tailwind CSS v4 (PostCSS) | @mlc-ai/web-llm (WebGPU LLM inference)
pdfjs-dist | pdf-lib | lucide-react | framer-motion
Target models: Llama 3.2 1B/3B Instruct (PII extraction), SmolVLM-256M (vision fallback)
Reference: ../meridian uses same WebLLM + Llama 3.2 1B pattern for in-browser AI

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
| SSN / CREDIT_CARD | Orange | --pii-ssn-cc |
| EMAIL / PHONE | Purple | --pii-email-phone |
| DATE | Teal | --pii-date |

## Key Files
| File | Purpose |
|------|---------|
| src/App.tsx | Main app, state machine (input→scanning→review→redacted) |
| src/lib/regex-patterns.ts | Instant regex PII detection (SSN, CC, email, phone, date) |
| src/lib/entity-types.ts | Entity category definitions + color config |
| src/lib/redactor.ts | Text replacement logic ([REDACTED] or black blocks) |
| src/hooks/useNERModel.ts | WebLLM model loading + PII inference (replacing token classifier) |
| src/lib/pii-prompt.ts | System prompt for structured PII extraction via LLM |
| src/lib/pdf-redactor.ts | Render-to-image PDF redaction + coordinate mapping |
| src/hooks/usePDFParser.ts | pdfjs-dist text extraction + page info + PDF doc ref |
| src/components/PDFPageViewer.tsx | Multi-page PDF viewer with zoom, lazy loading |
| src/components/PDFPageCanvas.tsx | Single PDF page canvas + clickable entity overlays |
| src/components/DropZone.tsx | PDF drag-and-drop + text paste input |
| src/components/DocumentViewer.tsx | Highlighted text with PII annotations (text-only mode) |
| src/components/DevViewer.tsx | AI transparency panel (prompt/response/parsed entities) |
| src/components/EntityList.tsx | Sidebar list of detected entities |
| src/components/RedactControls.tsx | Accept/reject/redact-all controls |
| src/components/ShareCard.tsx | Viral share card ("Redacted N entities. Zero bytes uploaded.") |
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
- Content stream surgery via pdf-lib for redaction — too many edge cases, one miss = data leak. Use render-to-image.
- bert-base-NER for PII — only 4 generic types (PER, ORG, LOC, MISC). Not built for PII.
- Piiranha v1 (DeBERTa token classifier) — broken BIO tags (all I-, no B-), label flipping mid-word, missed obvious names. Token classifiers don't understand context.
- Token classification approach in general — BIO tagging + subword merging is fragile. SentencePiece vs WordPiece, no char offsets from Transformers.js. LLM with structured JSON output is categorically better.
- pdfjs text extraction as sole text source — letter-spacing artifacts unsolvable. Vision model fallback needed.
- Naive `.join(' ')` on pdfjs text items — produces "C O N T A C T U S". Use position-based grouping.
- Gap thresholds (0.3x-1.5x char width) — can't disambiguate letter-spacing vs word gaps. Vision model is the answer.

## Session State
Last Updated: 2026-03-10 | Session 5
Current Status: In-place PDF redaction working. Phase 1-2 complete. Phase 4.1 mostly done.
PDF flow: upload → render pages in viewer → detect PII → colored overlay boxes → accept/reject → black boxes → download.
Text flow: paste → highlight text → detect → redact text → download.
Components: PDFPageViewer (multi-page, zoom, lazy) + PDFPageCanvas (per-page canvas + overlay divs).
Next: Test end-to-end with real PDFs, then Phase 3 (vision fallback).

## Archived Sessions
### Session 2 (2026-03-10)
NER subword merging fixed (6987cf3). PDF text extraction improved. v2 roadmap created.
### Session 3 (2026-03-10)
Tested Piiranha v1 — failed badly (no B- tags, missed names, label flipping). Pivoted to WebLLM approach.
Updated ROADMAP.md: Phase 1 now uses WebLLM + Llama 3.2 instead of token classifiers.
### Session 4 (2026-03-10)
Phase 1 complete: WebLLM + gemma-2-2b-it default, AI transparency panel, prompt anti-hallucination.
Phase 2.1-2.2 complete: render-to-image pipeline, coordinate mapping, box merging.
Fixed: JSON trailing commas, chat history bleed, hallucinated entities from example prompt.
Added written date regex patterns. Model table: gemma-2-2b active, Qwen tested, Llama rejected.
### Session 5 (2026-03-10)
In-place PDF redaction: PDFPageViewer + PDFPageCanvas render actual PDF pages with entity overlays.
Review mode: colored semi-transparent boxes per category. Redacted mode: solid black boxes.
Category toggles, keyboard shortcuts (Tab/Space/Enter/Delete), metadata sanitization complete.
Fixed text matching in pdf-redactor (mirrors extractPageText spacing for proper item lookup).
