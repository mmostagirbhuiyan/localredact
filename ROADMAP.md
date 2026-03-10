# LocalRedact v2 Roadmap: Edge AI Redaction Engine

> "EDGE AI on STEROIDS. LOOPED, CONTROLLED. WINNING."

## Vision
FBI-level PDF redaction running entirely on consumer hardware. No cloud. No token limits.
WebGPU-accelerated AI detection with multi-pass looped verification. True content destruction.

---

## Phase 1: Detection Engine Upgrade (Highest Impact)

Replace bert-base-NER (4 generic entity types) with purpose-built PII detection.

### 1.1 Piiranha v1 Integration
- [ ] Replace `Xenova/bert-base-NER` with `onnx-community/piiranha-v1-detect-personal-information-ONNX`
- [ ] 17 PII types, 98.5% precision, 98.3% recall — purpose-built for PII
- [ ] Update `useNERModel.ts` entity label mapping for Piiranha's label set
- [ ] Update entity-types.ts with new PII categories (MEDICAL, FINANCIAL, etc.)

### 1.2 WebGPU Acceleration
- [ ] Add `device: 'webgpu'` to pipeline initialization (Transformers.js v3+ supports this)
- [ ] WASM fallback for older browsers (automatic in Transformers.js)
- [ ] Benchmark: expect ~4x speedup over WASM for BERT-sized models

### 1.3 Multi-Pass Looped Detection
- [ ] Pass 1: Regex sweep (SSN, phone, email, CC, dates, IPs) — deterministic, instant
- [ ] Pass 2: Piiranha NER sweep via WebGPU — names, orgs, locations, medical, financial
- [ ] Pass 3: Context re-scan — for each entity, re-examine ±200 char window for missed associations
- [ ] Pass 4: Confidence gate — below 0.85 flagged for review, above 0.95 auto-accepted
- [ ] No token limits. Loop until coverage is complete.

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
- [ ] Use vision output as input to detection pipeline (same multi-pass loop)

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
| Model | Purpose | Size | Format |
|-------|---------|------|--------|
| Piiranha v1 | PII detection (17 types) | ~50MB | ONNX |
| SmolVLM-256M | Vision model (page reading) | ~256MB | ONNX |
| GLiNER-PII (future) | Zero-shot NER (60+ types) | ~67MB | ONNX |
| SmolDocling (future) | Document structure | TBD | ONNX |

### WebGPU Browser Support (as of 2026)
- Chrome 113+ (shipped May 2023)
- Safari 26+ (shipped 2025)
- Firefox 141+ (shipped 2025)
- Automatic WASM fallback via Transformers.js

---

## Dead Approaches
- **Content stream surgery via pdf-lib**: Too many edge cases (fonts, CIDFonts, Type3, ligatures, encoding). One miss = data leak. Render-to-image is safer.
- **bert-base-NER for PII**: Only 4 generic entity types (PER, ORG, LOC, MISC). Not built for PII. Piiranha has 17 PII-specific types at 98%+ accuracy.
- **pdfjs text extraction as sole text source**: Letter-spacing artifacts in styled PDFs are unsolvable at the text extraction level. Vision model fallback required.
- **Naive `.join(' ')` on pdfjs text items**: Produces "C O N T A C T U S". Must use position-based grouping.
- **Multiple gap thresholds (0.3x, 0.7x, 0.8x, 1.5x char width)**: None fully solve letter-spacing vs word-gap ambiguity. Vision model is the real answer.
