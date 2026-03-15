# LocalRedact v2 Roadmap

> Browser-native PII redaction. No cloud. No token limits. WebGPU-accelerated.

## Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Detection Engine (WebLLM + Qwen3-4B) | **COMPLETE** |
| 2 | True PDF Redaction (render-to-image) | **COMPLETE** |
| 3 | OCR Fallback (Tesseract.js) | **COMPLETE** |
| 4 | UX Polish | **COMPLETE** |

---

## Phase 1: Detection Engine — COMPLETE

Two-phase pipeline: regex (instant) + WebLLM LLM (lazy-loaded via WebGPU).

### 1.1 WebLLM Integration — DONE
- [x] `@mlc-ai/web-llm` dependency, WebGPU detection, iOS exclusion
- [x] Lazy model loading with progress callback (cached after first load)
- [x] Model: Qwen3-4B-q4f16_1-MLC (~2.5GB, temp 0, max_tokens 1024)
- [x] Engine lifecycle: abort controller, detecting mutex, engine reuse on Start Over

### 1.2 LLM-Based PII Extraction — DONE
- [x] `src/lib/pii-prompt.ts` — structured JSON extraction prompt with /no_think
- [x] Chunking: ~1500 chars with 200-char overlap, smart sentence breaks
- [x] JSON parsing: markdown fence stripping, `<think>` block removal, trailing comma fix
- [x] Entity position matching: exact + fuzzy whitespace matching against source text

### 1.3 Two-Phase Detection Pipeline — DONE
- [x] Phase 1: Regex sweep (instant) — SSN, CC, email, phone, dates
- [x] Phase 2: LLM sweep — names, orgs, locations, addresses, account numbers
- [x] Deduplication across regex and LLM results
- [x] Source attribution (regex vs ner) on each entity

### 1.4 AI Transparency — DONE
- [x] DevViewer: system prompt, user prompt, raw response, parsed entities
- [x] Chunk navigation (clickable numbered buttons per chunk)
- [x] LLM inference progress bar ("AI scanning text — Chunk X of Y")

### 1.5 Dependency Cleanup — DONE
- [x] Remove `@huggingface/transformers` (SmolVLM replaced by Tesseract.js)

---

## Phase 2: True PDF Redaction — COMPLETE

Render-to-image pipeline. Content destruction, not visual overlay.

### 2.1 Render-to-Image Core — DONE
- [x] pdfjs renders pages to Canvas at 216 DPI (3x scale)
- [x] Black rectangles drawn over PII regions
- [x] pdf-lib creates image-only PDF — no original text survives

### 2.2 Coordinate Mapping — DONE
- [x] PDF→canvas coordinate transform (Y-flip, scale factor)
- [x] Per-entity bounding boxes with box merging for overlapping items
- [x] Horizontal padding (fontSize * 0.1) for proportional font coverage

### 2.3 Metadata Sanitization — DONE
- [x] Wipe title, author, dates; strip XMP metadata
- [x] Fresh PDFDocument.create() = no embedded files/forms/JS
- [x] Full rewrite save (not incremental)
- [x] Hex editor verification (grep output for original PII strings)

---

## Phase 3: OCR Fallback (Tesseract.js) — COMPLETE

For PDFs where text extraction fails: scanned docs, image-only PDFs, photographed documents.

### 3.1 Tesseract.js OCR Integration — DONE
- [x] Tesseract.js v7 WASM+WebWorker (CPU-based, no GPU conflict with Qwen3-4B)
- [x] Per page: render to canvas at 4x scale (~300 DPI) → gamma preprocessing → OCR
- [x] Word-level bounding boxes for targeted redaction (not full-page blackout)
- [x] Auto-trigger on low text quality (score=0 = scanned/image-only page)
- [x] `{ blocks: true }` output format (v7 defaults to text-only without it)
- [x] `user_defined_dpi: '300'` (prevents Tesseract DPI guessing)

### 3.2 OCR-to-Redaction Pipeline — DONE
- [x] OCR text fed into regex + LLM detection pipeline (same as text PDFs)
- [x] OCR word bboxes passed through PDFPageViewer → PDFPageCanvas for review overlays
- [x] `findOCRTextBounds` maps entities to OCR word bounding boxes
- [x] Edit-distance (Levenshtein) matching for LLM text vs OCR text near-misses
- [x] `createRedactedPDF` accepts optional OCR results per page

### 3.3 Auto-Rotation for Sideways Scans — DONE
- [x] If initial OCR confidence < 50%, try 90 CW and 90 CCW rotations
- [x] Pick rotation with highest average word confidence
- [x] Transform bounding boxes back to original page coordinate system
- [x] Handles scanned certificates stored sideways in portrait-dimensioned PDFs

### 3.4 Dead Approaches
- SmolVLM-256M: no bounding boxes, too small, wrong API. Replaced by Tesseract.js.
- Otsu binarization: too aggressive on watermarked docs. Gamma contrast works.
- cleanText filtering: dropped real PII. Use raw OCR text.
- preserve_interword_spaces: doubled word count with noise.

---

## Phase 4: UX Polish — COMPLETE

### 4.1 Review Interface
Done:
- [x] In-place PDF viewer with pdfjs rendering + colored PII overlays
- [x] PDFPageViewer: multi-page, zoom, lazy loading
- [x] PDFPageCanvas: per-page canvas + clickable entity overlays
- [x] Review mode (colored boxes) and redacted mode (black boxes) toggle
- [x] Category toggles (redact all PERSON, keep all ORG, etc.)
- [x] Keyboard shortcuts: Tab/Shift+Tab, Space, Enter, Delete
- [x] Focused entity highlighting with auto-scroll
- [x] Entity accept/reject per entity (sidebar + overlay click)
- [x] Entity dedup in sidebar (grouped rows with count badges, group toggle)

Todo:
- [x] Entity text editing (inline rename of detected text)
- [x] Confidence scores per entity (requires LLM prompt changes)

### 4.2 Export Options
Done:
- [x] Redacted PDF download (image-only, render-to-image pipeline)
- [x] Redacted text download (plain text mode)

Todo:
- [x] Redaction report (what was found/redacted, entity counts by category)
- [x] Side-by-side before/after comparison view

### 4.3 Batch Processing
- [x] Multi-file drag-and-drop
- [x] Queue with per-file progress
- [x] Batch redaction settings (apply same rules to all files)

---

## Models

| Model/Engine | Purpose | Size | Status |
|-------|---------|------|--------|
| Qwen3-4B (q4f16) | PII extraction | ~2.5GB | **Active** (WebGPU) |
| Tesseract.js v7 | OCR fallback | ~3-5MB | **Active** (WASM+WebWorker) |
| SmolVLM-256M | Vision fallback | ~256MB | Replaced (no bboxes, too small) |
| gemma-2-2b-it | PII extraction | ~830MB | Replaced (empty results on dense docs) |
| Llama 3.2 1B/3B | PII extraction | ~500MB/1.5GB | Rejected (safety refusal) |

## Dead Approaches

These were tried and failed. Do NOT retry them:

- **Content stream surgery** (pdf-lib): Too many edge cases. One miss = data leak.
- **bert-base-NER**: Only 4 generic types (PER/ORG/LOC/MISC). Not PII-aware.
- **Piiranha v1 (DeBERTa)**: Broken BIO tags (all I-, no B-), label flipping, missed names.
- **Token classification in general**: BIO + subword merging is fragile. LLM + structured JSON is better.
- **pdfjs text extraction alone**: Letter-spacing artifacts unsolvable. Vision model needed.
- **Naive `.join(' ')` on text items**: Produces "C O N T A C T U S".
- **Gap thresholds (0.3x-1.5x char width)**: Can't solve letter-spacing vs word-gap ambiguity.
- **gemma-2-2b-it**: Empty `text` values on dense/tabular content. Too small.
- **Llama 3.2 for PII**: Safety alignment refuses to extract PII.
- **Example entities in prompt**: Causes hallucination across documents.
- **Concurrent WebLLM detect() calls**: Corrupts GPU buffer state. Must serialize with mutex.
- **Confidence field in LLM prompt**: Adding `"confidence":0.95` to the output format distracted Qwen3-4B — missed addresses and names on dense PDFs. Compute confidence from match quality instead (exact=0.95, fuzzy=0.80).
- **SmolVLM-256M for OCR**: Returns plain text only — no bounding boxes for targeted redaction. Too small (256M) to reliably extract names from passports. Wrong `batch_decode` API. Replaced by Tesseract.js.
- **Otsu binarization for OCR preprocessing**: Too aggressive on passport watermarks/holograms. Wipes out real text along with background. Gamma contrast stretch works better.
- **cleanText filtering (confidence-based)**: Filtering OCR lines by avg word confidence drops real PII mixed with low-confidence noise. Send raw OCR text to LLM instead.
- **preserve_interword_spaces for Tesseract**: Doubles word count with inserted spaces, breaks regex patterns and LLM entity matching.

## References

- **First Look Media pdf-redact-tools**: Rasterize pipeline, used by The Intercept. Our primary reference.
- **Microsoft Presidio**: Open-source PII detection (regex + NER + context). Detection pipeline reference.
- **Meridian project**: WebLLM + in-browser AI pattern reference.

> "Redaction is a data destruction problem, not a rendering problem."
