# LocalRedact

## Critical Rules
1. NO backend calls. NO fetch to external APIs. Everything runs in the browser.
2. NO slop — no emojis in code/logs, no AI-isms, no over-engineering
3. Match existing patterns — search before creating new ones
4. Regex results MUST appear before NER model loads (two-phase UX)
5. Test on mobile viewport before marking any UI task done
6. Update Session State at END of each session

## Architecture
React SPA. Multi-pass PII detection: regex (instant) + Transformers.js ONNX NER (lazy-loaded, WebGPU).
PDF text extraction via pdfjs-dist with SmolVLM vision fallback for problematic PDFs.
True PDF redaction via render-to-image pipeline (pdfjs canvas → black boxes → pdf-lib image-only PDF).
Hosted on Cloudflare Pages (static). See ROADMAP.md for full v2 implementation plan.

## Tech Stack
Vite | React 18 | TypeScript | Tailwind CSS v4 (PostCSS) | Transformers.js (@huggingface/transformers v3+)
pdfjs-dist | pdf-lib | lucide-react | framer-motion
Target models: Piiranha v1 (PII detection), SmolVLM-256M (vision fallback)

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
| src/hooks/useNERModel.ts | Transformers.js model loading + inference |
| src/hooks/usePDFParser.ts | pdfjs-dist text extraction |
| src/components/DropZone.tsx | PDF drag-and-drop + text paste input |
| src/components/DocumentViewer.tsx | Highlighted text with PII annotations |
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
- bert-base-NER for PII — only 4 generic types. Piiranha v1 has 17 PII types at 98%+ accuracy.
- pdfjs text extraction as sole text source — letter-spacing artifacts unsolvable. Vision model fallback needed.
- Naive `.join(' ')` on pdfjs text items — produces "C O N T A C T U S". Use position-based grouping.
- Gap thresholds (0.3x-1.5x char width) — can't disambiguate letter-spacing vs word gaps. Vision model is the answer.

## Session State
Last Updated: 2026-03-10 | Session 2
Current Status: v1 functional (regex + bert-base-NER). Research complete for v2 architecture.
NER subword merging fixed (commit 6987cf3). PDF text extraction improved but has letter-spacing limits.
Next: Phase 1 of ROADMAP.md — replace bert-base-NER with Piiranha v1, add WebGPU, multi-pass detection.

## Archived Sessions
<!-- None yet -->
