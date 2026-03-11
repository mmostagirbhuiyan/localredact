# LocalRedact v2 Roadmap: Edge AI Redaction Engine

> "EDGE AI on STEROIDS. LOOPED, CONTROLLED. WINNING."

## Vision
FBI-level PDF redaction running entirely on consumer hardware. No cloud. No token limits.
WebGPU-accelerated LLM for PII detection with multi-pass verification. True content destruction.

---

## Phase 1: Detection Engine Upgrade (Highest Impact)

Replace token classifiers (bert-base-NER, Piiranha) with a real LLM via WebLLM.
Modern laptops have the compute. A 1-3B instruct model understands context, follows instructions,
and produces structured JSON — no BIO tag gymnastics, no broken subword merging.

### 1.1 WebLLM Integration
- [x] Add `@mlc-ai/web-llm` dependency
- [x] Create WebLLM hook — adapted pattern from Meridian project (integrated into useNERModel.ts)
- [x] WebGPU support detection (navigator.gpu), iOS exclusion, mobile checks
- [x] Lazy model loading with progress callback (model cached after first load)
- [x] Model selection: `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` (Llama 3.2 refused PII work)

### 1.2 LLM-Based PII Extraction
- [x] Create `src/lib/pii-prompt.ts` — system prompt for structured PII extraction
- [x] Prompt design: input text → JSON array of `{type, text}` entities
- [x] Low temperature (0.1) for deterministic extraction
- [x] Chunking strategy: split text into ~1500 char chunks with smart sentence/paragraph breaks
- [x] JSON response parsing with markdown fence stripping, validation, and fallback

### 1.3 Two-Phase Detection Pipeline
- [x] Phase 1: Regex sweep (instant) — SSN, CC, email, phone, dates
- [x] Phase 2: LLM sweep via WebGPU — names, orgs, locations, addresses
- [x] Deduplicate: if regex already found an entity at [start, end], skip LLM duplicate
- [x] Merge results into unified entity list with source attribution (regex vs ner)

### 1.4 Replace useNERModel Hook
- [x] Rewrite `src/hooks/useNERModel.ts` → uses WebLLM instead of Transformers.js token-classification
- [x] Same public interface: `{ loading, ready, progress, error, loadModel, detect }`
- [ ] Remove `@huggingface/transformers` dependency (keep for Phase 3 vision model)
- [x] Update vite.config.ts chunking: web-llm chunk replaces transformers chunk

### 1.5 AI Transparency Panel
- [x] DevViewer component showing system prompt, user prompt, raw LLM response, parsed entities
- [x] Collapsible accordion sections, model ID badge, read-only

---

## Phase 2: True PDF Redaction (Render-to-Image Pipeline)

Content destruction, not visual overlay. Same approach as First Look Media's pdf-redact-tools.

### 2.1 Render-to-Image Core
- [ ] pdfjs renders each page to Canvas at 300 DPI
- [ ] Map detected PII coordinates (from text extraction) to canvas pixel positions
- [ ] Draw opaque black rectangles over PII regions
- [ ] Export canvas to PNG
- [ ] pdf-lib creates new PDF with image-only pages — NO original text survives

### 2.2 Coordinate Mapping
- [ ] pdfjs TextItem transform[4]=X, transform[5]=Y (PDF coordinate space, bottom-left origin)
- [ ] Canvas uses top-left origin — Y-flip required: `canvasY = pageHeight - pdfY`
- [ ] Scale factor: `canvasWidth / pdfPageWidth` (viewport scale from pdfjs render)
- [ ] Store per-entity bounding boxes: `{pageIndex, x, y, width, height}` in PDF points

### 2.3 Metadata Sanitization
- [ ] pdf-lib: wipe title, author, subject, creator, producer, dates
- [ ] Strip XMP metadata via catalog.delete(PDFName.of('Metadata'))
- [ ] Remove embedded files (Names), form fields (AcroForm), JavaScript (AA, OpenAction)
- [ ] Full rewrite save (not incremental) to eliminate orphaned objects
- [ ] Verify: open output in hex editor, grep for original PII strings — must find zero

---

## Phase 3: Vision Model Fallback

For PDFs where text extraction fails (scanned docs, letter-spacing artifacts, image-heavy layouts).

### 3.1 SmolVLM-256M Integration
- [ ] Load SmolVLM-256M via Transformers.js with WebGPU
- [ ] For each page: render to canvas → feed to vision model → get structured text
- [ ] Auto-trigger when pdfjs text quality is low (heuristic: high single-char item ratio, letter-spacing variance)
- [ ] Use vision output as input to detection pipeline (same two-phase loop)

### 3.2 Vision-Based PII Verification
- [ ] After text-based detection, render page with redaction boxes removed
- [ ] SmolVLM scans rendered page for any visible PII that text extraction missed
- [ ] Catches: PII in images, watermarks, headers rendered as graphics, stamped signatures

### 3.3 SmolDocling (Optional)
- [ ] Document-to-structured-text model for complex layouts (tables, multi-column)
- [ ] Evaluate if needed after SmolVLM integration — may be redundant

---

## Phase 4: UX Polish

### 4.1 Review Interface
- [ ] Side-by-side before/after preview (original page vs redacted page)
- [ ] Entity review panel: accept/reject/edit per entity with confidence scores
- [ ] Category toggles: redact all PERSON, keep all ORGANIZATION, etc.
- [ ] Keyboard shortcuts for rapid review (Tab to next, Enter to accept, Delete to reject)

### 4.2 Batch Processing
- [ ] Multi-file drag-and-drop
- [ ] Queue processing with progress per file
- [ ] Batch redaction settings (apply same rules to all files)

### 4.3 Export Options
- [ ] Redacted PDF (image-only, default)
- [ ] Redacted PDF with OCR layer (searchable, but only redacted text)
- [ ] Redaction report (what was found, what was redacted, confidence scores)
- [ ] Side-by-side comparison PDF

---

## Research References

### Enterprise Redaction (How the Pros Do It)
- **Relativity / Brainspace**: Content stream surgery + ML classification. Used by DOJ, law firms.
- **Nuix**: Forensic-grade. Processes terabytes. Content stream level.
- **Adobe Acrobat Pro**: "Remove Hidden Information" + visual redaction. Industry standard UX.
- **FOIA shops**: Often use rasterize approach (print to image) as nuclear option.
- **First Look Media pdf-redact-tools**: Rasterize pipeline. Used by The Intercept journalists. Our primary reference.
- **Microsoft Presidio**: Open-source PII detection engine. Regex + NER + context. Our detection pipeline reference.

### Key Insight
> "Redaction is a data destruction problem, not a rendering problem."
> Content stream surgery must handle every edge case or data leaks. Render-to-image is mathematically complete — if you can't see it, it's gone.

### Models
| Model | Purpose | Size | Status |
|-------|---------|------|--------|
| Qwen 2.5 1.5B Instruct (q4f16) | PII extraction — default | ~830MB | Active |
| gemma-2-2b-it (q4f16) | PII extraction — alternative | ~830MB | Tested, works |
| Llama 3.2 1B/3B Instruct | PII extraction | ~500MB/1.5GB | Rejected (safety refusal) |
| SmolVLM-256M | Vision model (page reading fallback) | ~256MB | Phase 3 |

### WebGPU Browser Support (as of 2026)
- Chrome 113+ (shipped May 2023)
- Safari 26+ (shipped 2025)
- Firefox 141+ (shipped 2025)
- iOS: blocked (WebKit WebGPU bugs cause crashes — see Meridian project for details)

### Reference Implementation
- **Meridian project** (`../meridian`): WebLLM + Llama 3.2 1B running in-browser for financial analysis
- Uses `@mlc-ai/web-llm@^0.2.80` with `CreateMLCEngine`
- Streaming chat completions, WebGPU detection, iOS exclusion, lazy loading
- Proven pattern: ~500MB model loads, caches, runs inference on consumer hardware

---

## Dead Approaches
- **Content stream surgery via pdf-lib**: Too many edge cases (fonts, CIDFonts, Type3, ligatures, encoding). One miss = data leak. Render-to-image is safer.
- **bert-base-NER for PII**: Only 4 generic entity types (PER, ORG, LOC, MISC). Not built for PII. Misses names in natural text.
- **Piiranha v1 (DeBERTa token classifier)**: Marketed as 98% accuracy but fails on basic inputs. No B- tags emitted (all I-), label flipping mid-word ("Terrac"=CITY, "e"=STREET), missed "Sarah Johnson" entirely. Broken BIO tagging scheme. Token classifiers are fundamentally limited — they don't understand context.
- **Token classification approach in general**: BIO tagging + subword merging is fragile. SentencePiece vs WordPiece differences, no character offsets from Transformers.js pipeline, fuzzy text matching required. An instruction-following LLM that outputs structured JSON is categorically better.
- **pdfjs text extraction as sole text source**: Letter-spacing artifacts in styled PDFs are unsolvable at the text extraction level. Vision model fallback required.
- **Naive `.join(' ')` on pdfjs text items**: Produces "C O N T A C T U S". Must use position-based grouping.
- **Multiple gap thresholds (0.3x, 0.7x, 0.8x, 1.5x char width)**: None fully solve letter-spacing vs word-gap ambiguity. Vision model is the real answer.
