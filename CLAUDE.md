# LocalRedact

## Critical Rules
1. NO backend calls. NO fetch to external APIs. Everything runs in the browser.
2. NO slop — no emojis in code/logs, no AI-isms, no over-engineering
3. Match existing patterns — search before creating new ones
4. Regex results MUST appear before NER model loads (two-phase UX)
5. Test on mobile viewport before marking any UI task done
6. Update Session State at END of each session

## Architecture
React SPA. Two-phase PII detection: regex (instant) + Transformers.js ONNX NER (lazy-loaded ~30MB).
PDF text extraction via pdfjs-dist. Redacted text output via plain text download.
PDF redaction with black bars planned for v1.5. Hosted on Cloudflare Pages (static).

## Tech Stack
Vite | React 18 | TypeScript | Tailwind CSS v4 (PostCSS) | Transformers.js (@xenova/transformers)
pdfjs-dist | pdf-lib | lucide-react | framer-motion

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
| /feature | Implement new feature |
| /fix | Fix a bug |
| /explore | Explore codebase |
| /release | Cut a release |
| /test | Write tests |

## Dead Approaches
<!-- Add as we learn -->

## Session State
Last Updated: 2026-03-10 | Session 1
Current Status: Project initialized, all Phase 1 files created. Needs npm install + build verification.
Next: Install deps, verify build, test regex detection, then Phase 2 (NER integration).

## Archived Sessions
<!-- None yet -->
