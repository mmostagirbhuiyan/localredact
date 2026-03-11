# LocalRedact v2 Roadmap

> Browser-native PII redaction. No cloud. No token limits. WebGPU-accelerated.

## Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Detection Engine (WebLLM + Qwen3-4B) | **COMPLETE** |
| 2 | True PDF Redaction (render-to-image) | **COMPLETE** |
| 3 | Vision Model Fallback (SmolVLM) | Not started |
| 4 | UX Polish | In progress |

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

### 1.5 Dependency Cleanup
- [ ] Remove `@huggingface/transformers` (deferred — needed for Phase 3 SmolVLM)

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
- [ ] Hex editor verification (grep output for original PII strings)

---

## Phase 3: Vision Model Fallback — NOT STARTED

For PDFs where text extraction fails: scanned docs, letter-spacing artifacts, image-heavy layouts.

### 3.1 SmolVLM-256M Integration
- [ ] Load SmolVLM-256M via Transformers.js with WebGPU
- [ ] Per page: render to canvas → vision model → structured text
- [ ] Auto-trigger on low text quality (high single-char item ratio)
- [ ] Feed vision output into existing two-phase detection pipeline

### 3.2 Vision-Based PII Verification
- [ ] Post-detection scan: render page without redaction boxes
- [ ] SmolVLM checks for PII that text extraction missed
- [ ] Catches: PII in images, watermarks, graphic-rendered text, stamps

### 3.3 SmolDocling (Optional)
- [ ] Document-to-structured-text for complex layouts (tables, multi-column)
- [ ] Evaluate after SmolVLM — may be redundant

---

## Phase 4: UX Polish — IN PROGRESS

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
- [ ] Entity text editing (inline rename of detected text)
- [ ] Confidence scores per entity (requires LLM prompt changes)

### 4.2 Export Options
Done:
- [x] Redacted PDF download (image-only, render-to-image pipeline)
- [x] Redacted text download (plain text mode)

Todo:
- [ ] Redaction report (what was found/redacted, entity counts by category)
- [ ] Side-by-side before/after comparison view

### 4.3 Batch Processing
- [ ] Multi-file drag-and-drop
- [ ] Queue with per-file progress
- [ ] Batch redaction settings (apply same rules to all files)

---

## Models

| Model | Purpose | Size | Status |
|-------|---------|------|--------|
| Qwen3-4B (q4f16) | PII extraction | ~2.5GB | **Active** |
| SmolVLM-256M | Vision fallback | ~256MB | Phase 3 |
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

## References

- **First Look Media pdf-redact-tools**: Rasterize pipeline, used by The Intercept. Our primary reference.
- **Microsoft Presidio**: Open-source PII detection (regex + NER + context). Detection pipeline reference.
- **Meridian project** (`../meridian`): WebLLM + in-browser AI pattern reference.

> "Redaction is a data destruction problem, not a rendering problem."
