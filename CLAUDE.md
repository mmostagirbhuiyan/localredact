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
Active model: Qwen3-4B-q4f16_1-MLC (PII extraction, ~2.5GB, WebGPU). SmolVLM-256M (vision fallback, Phase 3)
Reference: ../meridian uses same WebLLM pattern for in-browser AI

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
| src/lib/redaction-report.ts | Plain text redaction report generator |
| src/lib/__tests__/pdf-hex-verify.test.ts | Hex verification unit tests |
| src/components/DropZone.tsx | Multi-file drag-and-drop + text paste input |
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
- gemma-2-2b-it for PII — returns empty `text` values on dense/tabular content (utility bills). Too small for reliable structured extraction. Replaced by Qwen3-4B.
- Confidence field in LLM prompt — adding `"confidence":0.95` to output format distracted Qwen3-4B from extraction. Missed addresses and names on dense PDFs. Compute confidence from match quality instead (exact=0.95, fuzzy=0.80, regex=1.0).

## Session State
Last Updated: 2026-03-11 | Session 9
Current Status: Phases 1, 2, 4 COMPLETE. Only Phase 3 (SmolVLM vision fallback) remains.
PDF flow: upload (single or batch) → render pages → regex (instant) → LLM (chunked, progress bar) → colored overlays → accept/reject → black boxes → hex verify → download.
Text flow: paste → highlight → detect → redact → download.
Batch flow: multi-file drop → per-file queue with progress → category rules → Redact & Next File → Download All.
Model: Qwen3-4B-q4f16_1-MLC (~2.5GB, cached). Temp 0, max_tokens 1024, /no_think.
Confidence: computed from text match quality (exact=0.95, fuzzy=0.80, regex=1.0). NOT from LLM output.
Known issues: LLM non-deterministic on chunk count (sometimes finds more ORG duplicates). Chunk 4-5 can be slow on dense text.
Next: Phase 3 (SmolVLM vision fallback for scanned PDFs), then deploy.

## Archived Sessions
### Sessions 2-5 (2026-03-10)
Built core pipeline: regex detection, WebLLM integration, render-to-image PDF redaction,
in-place PDF viewer with entity overlays, keyboard shortcuts, metadata sanitization.
Rejected: bert-base-NER, Piiranha v1, token classification, Llama 3.2 (safety refusal).
### Session 6 (2026-03-10)
LLM overhaul: gemma-2-2b → Qwen3-4B. Fixed NER re-trigger bug, fuzzy text matching,
`<think>` stripping, ACCOUNT_NUMBER type, chunk overlap. Verified on test text.
### Session 7 (2026-03-10)
Tested on real PSEG utility bill PDF. Found and fixed critical Start Over race condition:
concurrent detect() calls corrupted WebLLM engine state (GPUBuffer unmapped, tokenizer deleted).
Fix: abort controller + detecting mutex + engine reuse on reload. Added LLM inference progress
bar ("AI scanning text — Chunk X of Y"). DevViewer now has clickable chunk navigation.
Reduced max_tokens 2048→1024 for faster inference. EntityList now collapses duplicate
text+category into grouped rows with count badges and group toggle.
### Session 8 (2026-03-11)
Hex verification for redacted PDF bytes. Added entity text inline editing (double-click/pencil).
Added confidence scores with color-coded badges. Redaction report download. Side-by-side
before/after comparison view for both PDF and text modes. DevViewer chunk nav overflow fix.
Added EMAIL/PHONE/SSN/CREDIT_CARD mappings to mapLLMType.
### Session 9 (2026-03-11)
Fixed critical quality regression: confidence field in LLM prompt distracted Qwen3-4B, causing
missed addresses/names on PSEG bill. Reverted prompt, compute confidence from match quality.
Phase 4 completed: batch processing with multi-file drag-and-drop, per-file queue with live
progress (parsing/AI scanning/reviewing/redacting phases), batch category rules, "Redact & Next
File" one-click flow, Download All, skip files. Fixed batch UX: "ready to redact" instead of
"reviewing" to clarify system is waiting for user action. Spinner only animates during processing.
