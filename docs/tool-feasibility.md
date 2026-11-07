# PDFEdits — feasibility of the 27 tools, locally

**Verdict:** all 27 are technically achievable in a browser with no server, but they are not equal.
17 need nothing beyond two mature MIT/Apache libraries. 10 need a heavier WASM engine, custom
parser work, or an honest caveat in the UI.

Effort scale: **S** ≈ 1–2 days · **M** ≈ 3–5 days · **L** ≈ 1–2 weeks (one engineer, excl. polish/tests).

---

## Engines

| Engine | Licence | Gives us | Does not give us |
|---|---|---|---|
| **pdf-lib** | MIT | Page copy/merge/split, rotation, crop boxes, text & image drawing, embedded fonts, AcroForm fill + flatten, metadata, form fields | Encryption, text extraction, rendering, stream recompression |
| **pdf.js** (`pdfjs-dist`) | Apache-2.0 | Rendering to canvas, positioned text extraction, form rendering, thumbnails | Any authoring |
| **MuPDF.js** (WASM) | AGPL-3.0 or commercial (Artifex) | True redaction, encryption/decryption, real annotation objects, content editing, conversion | Free use in a closed-source product |
| **qpdf** (WASM builds) | Apache-2.0 (engine) | Encryption/decryption, linearisation, recovery of some broken files | Stable first-party JS packaging |
| **fflate** | MIT | ZIP export (split/export batches) | — |
| **tesseract.js** | Apache-2.0 | OCR (not in the 27; heavy ~10–20 MB models) | Speed on large scans |

`pdf-lib` **cannot open an encrypted PDF at all** (it throws), so any encryption feature, and even
"open my password-protected file", forces the WASM engine decision early.

---

## The 27, one by one

### Organise (8)

| # | Tool | Verdict | Approach | Effort | Caveat |
|---|---|---|---|---|---|
| 1 | Merge | ✅ Ready | `copyPages` across documents, concatenate | S | Memory ≈ sum of inputs |
| 2 | Split | ✅ Ready | `copyPages` per range; ZIP with fflate | S | Page count drives output size |
| 3 | Delete pages | ✅ Ready | `copyPages` everything except the selection | S | — |
| 4 | Arrange | ✅ Ready | `copyPages` in the chosen order | S | Thumbnail rendering via pdf.js |
| 5 | Rotate | ✅ Ready | `page.setRotation(90/180/270)` | S | Rotate the viewer, not the content |
| 6 | Crop | ✅ Ready | `setCropBox` / `setMediaBox` | S–M | CropBox is non-destructive; "trim for real" needs content translation and can clip stamps |
| 7 | N-up & booklet | ✅ Ready | `embedPage` with scale + translate onto a new sheet | M | Imposition maths, gutter, bleed |
| 8 | Insert pages | ✅ Ready | `copyPages` at an index, or blank sheets | S | — |

### Edit (6)

| # | Tool | Verdict | Approach | Effort | Caveat |
|---|---|---|---|---|---|
| 9 | Page numbers | ✅ Ready | `drawText` with StandardFonts or embedded font | S | Range, start offset, margins, mirrored pages |
| 10 | Watermark | ✅ Ready | `drawText` with rotate + opacity, or tiled `drawImage` | S | Contrast and placement heuristics |
| 11 | Annotate | ⚠️ Care | pdf-lib draws permanent page content, not annotation objects | M | "Editable annotations" needs MuPDF; otherwise mark as "burn-in" |
| 12 | Fill & sign | ✅ Ready | AcroForm `getForm()` + `drawImage` for the signature | M | Visual signature only — not a cryptographic/PAdES signature |
| 13 | Redact | ⛔ Heavy | True removal = content-stream surgery (MuPDF), or rasterise + paint | L | Rasterising destroys the text layer; never call a black rectangle "redaction" |
| 14 | Headers & footers | ✅ Ready | `drawText`, template variables | S | — |

### Convert (6)

| # | Tool | Verdict | Approach | Effort | Caveat |
|---|---|---|---|---|---|
| 15 | PDF → images | ✅ Ready | pdf.js render → canvas → `toBlob` (PNG/JPEG), ZIP | M | DPI × page count memory; iOS canvas area limits need tiling |
| 16 | Images → PDF | ✅ Ready | `embedJpg` / `embedPng`, one page per image | S | EXIF orientation, alpha, very large photos |
| 17 | PDF → text | ✅ Ready | pdf.js `getTextContent`, page separator | S | Layout/columns need reconstruction; no OCR |
| 18 | PDF → Office | ⚠️ Best effort | Text + positions → `docx`; tables → SheetJS | L | Layout fidelity is poor; label "best effort", never "exact" |
| 19 | HTML → PDF | ⚠️ Care | Browser print-to-PDF, or html2canvas + jsPDF | M | Print flow is a dialog, not a file; canvas route rasterises text |
| 20 | Extract images | ⚠️ Care | Walk XObject streams (`DCTDecode`, `FlateDecode`), or MuPDF | M | Masks, CMYK/JPX, duplicate references, tiny assets |

### Secure (4)

| # | Tool | Verdict | Approach | Effort | Caveat |
|---|---|---|---|---|---|
| 21 | Encrypt | ⚠️ Engine | `pdf-encrypt-lib` add-on or MuPDF/qpdf WASM | M–L | PDF-lib has no encryption; AES-256 + permissions must be tested against readers |
| 22 | Unlock | ⚠️ Engine | qpdf/MuPDF decrypt with the user's password | M | Needs password entry UX; only for passwords the user knows |
| 23 | Metadata scrub | ✅ Ready | Clear Info dict + remove catalog XMP; strip image EXIF on rewrite | S | Incremental-update history and embedded EXIF need extra passes |
| 24 | Flatten | ✅ Ready | `form.flatten()` + draw annotation appearances | S | Some appearance streams are missing/malformed |

### Optimise (3)

| # | Tool | Verdict | Approach | Effort | Caveat |
|---|---|---|---|---|---|
| 25 | Compress | ⚠️ Care | Re-encode image XObjects (canvas codec) + drop metadata | M–L | Never rasterise text; size/quality must be previewed |
| 26 | Image optimiser | ⚠️ Care | Same pipeline, image-only scope | M–L | — |
| 27 | Repair | ⛔ Unreliable | MuPDF/qpdf salvage; rebuild xref via re-save | L | Low success rate on truly broken files; set expectations in UI |

---

## Build order

### Phase 1 — ship without blockers (9 tools, pdf-lib + pdf.js only)
Merge · Split · Delete pages · Arrange · Rotate · Crop · PDF → images · Images → PDF · PDF → text

All page-copy or render operations. No licensing questions, no new engine, shared thumbnail + page-order UI.
This is the credible v0.1.

### Phase 2 — same engine, more surface (8 tools)
Insert pages · N-up & booklet · Page numbers · Watermark · Headers & footers · Fill & sign · Metadata scrub · Flatten

Text/image drawing and form APIs. No architectural change.

### Phase 3 — custom parsing (4 tools)
Extract images · Annotate · Compress · Image optimiser

Needs low-level XObject/stream handling and a quality preview. Still pdf-lib/pdf.js, but more test surface.

### Phase 4 — new engine or explicit caveats (6 tools)
Encrypt · Unlock · Redact · PDF → Office · HTML → PDF · Repair

This is the point where MuPDF.js (AGPL/commercial) versus qpdf WASM versus "accept the limitation" has to be decided. Do not put these on the landing page as "next" before that decision.

---

## Risks to design around

1. **Memory** — pdf-lib holds the whole document in memory; practical ceiling is a few hundred MB on desktop, far less on iOS. Stream pages, show progress, refuse politely above a threshold.
2. **Mobile canvas limits** — iOS Safari caps canvas area (~16.7 M px); render tiles at 150–200 DPI.
3. **Encrypted input** — pdf-lib throws; detect `Encrypt` in the trailer and route to a "needs password" state once the engine exists.
4. **Fonts** — StandardFonts are Latin-only; CJK/Cyrillic needs an embedded font subset (+ licence for the font file).
5. **Malformed PDFs** — pdf-lib is strict; wrap every parse in a clear error state, never a blank screen.
6. **The "local" claim** — no third-party scripts, no analytics SDKs, CSP, self-hosted assets, service worker for offline. A single CDN tag would undermine the whole page.

## Landing-page accuracy

The page now labels the nine shipped tools `Live` (Phase 1: merge, split, delete, arrange, rotate,
crop, PDF → images, images → PDF, PDF → text) and keeps `Next` / `Planned` for the rest, so the
roadmap chips follow the phases above rather than the alphabet.
