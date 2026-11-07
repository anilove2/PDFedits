# PDFEdits

A PDF toolkit that runs entirely in the browser — **pdfedits.in**. Nothing is uploaded:
files are opened, edited and written back inside the tab.

- **Landing page:** `/` — positioning (local processing, privacy, security), roadmap, comparison, FAQ.
- **Editor:** `/app/` — the working Phase 1 toolkit, no server, no accounts.
- **Offline:** a service worker caches the shell, so the editor keeps working without a connection.
- **Brand:** minimal / Swiss, document grey + scan blue, Plus Jakarta Sans (self-hosted).

## Run it locally

**Windows:** double-click `start.cmd` — starts the local server and opens the editor.

**Or:**

```bash
node scripts/serve.js
# landing  http://127.0.0.1:4321/
# editor   http://127.0.0.1:4321/app/
```

Do not open `app/index.html` from disk: browsers block ES modules on `file://`. The editor detects
that and explains it; the landing page shows a banner with the same instruction.

## What ships today

| Group | Tools |
|---|---|
| Organise | Merge (add several PDFs), Split (every page or ranges → ZIP), Delete pages, Arrange (drag or `Alt`+↑/↓), Rotate, Crop |
| Convert | PDF → images (PNG/JPG at 96–300 DPI, ZIP), Images → PDF, PDF → text |

Keyboard: `R` rotate right · `Shift+R` rotate left · `Delete` remove page (toast offers Undo) · `Alt`+↑/↓ move page.

## Deploy to Vercel

The site is static — no build step, no server functions.

1. Push this folder to a Git repository (GitHub/GitLab/Bitbucket).
2. In Vercel: **Add New → Project → Import** the repo.
   - Framework Preset: **Other**
   - Root Directory: `./`
   - Build Command: *(leave empty)*
   - Output Directory: *(leave empty)*
3. Deploy. `vercel.json` supplies the security headers, cache policy and trailing-slash rules.
   `.vercelignore` keeps `node_modules`, `scripts`, `preview`, `docs`, `design-system` and the dev
   launcher out of the deployment.
4. When **pdfedits.in** is registered, add it under **Project → Settings → Domains**, then at BigRock:

   | Type | Name | Value |
   |---|---|---|
   | A | `@` | `76.76.21.21` |
   | CNAME | `www` | `cname.vercel-dns.com` |

   Vercel issues the TLS certificate automatically once DNS resolves.

### What is configured

| File | Purpose |
|---|---|
| `vercel.json` | CSP, HSTS, `nosniff`, referrer + permissions policy, immutable caching for `/assets/fonts` and `/app/vendor`, 404 (via `404.html`), `sw.js` revalidation |
| `.vercelignore` | keeps dev-only folders out of the upload |
| `robots.txt`, `sitemap.xml` | `https://pdfedits.in/` and `/app/` |
| `404.html` | branded not-found page |
| `assets/og-image.png` | 1200×630 social card referenced by Open Graph and Twitter meta |
| `sw.js` | offline shell (network-first pages, cache-first assets) |

## Structure

```
index.html                 landing page
app/index.html             editor shell (dialogs, toolbar, rail)
app/app.css                editor-only layout + components
app/app.js                 page model, interactions, pipeline
app/engine.js              pdf-lib: assemble, split, images→PDF, ZIP
app/viewer.js              pdf.js: open, render to canvas, text extraction
app/boot.js                theme + file:// notice + service worker registration
app/vendor/                pinned browser builds (pdf-lib, pdf.js + worker, wasm decoders, fflate)
assets/css/tokens.css      shared design tokens (landing + editor)
assets/css/styles.css      landing layout, themes, motion
assets/js/main.js          landing interactions
assets/js/boot.js          theme + file:// banner + service worker registration
assets/og-image.png        1200×630 social card
sw.js                      offline cache
vercel.json                deployment + security headers
404.html                   branded 404
scripts/serve.js           zero-dependency static server (mirrors the Vercel headers)
scripts/test-app.js        end-to-end editor test
scripts/test-offline.js    service worker + offline boot test
scripts/test-file-mode.js  file:// fallback test
scripts/shot.js            landing screenshots + interaction checks
scripts/vendor.js          copies browser builds from node_modules into app/vendor
scripts/make-fixtures.js   prints fixture HTML to real PDFs via headless Chrome
scripts/make-brand-assets.js renders the social card and touch icon
docs/tool-feasibility.md   feasibility of all 27 planned tools
design-system/pdfedits/    generated design system (tokens, palette, motion rules)
```

## How the pipeline works

1. A PDF is read into a `Uint8Array`; **pdf.js** parses it for thumbnails, preview and text.
2. The page model is a list of `{docId, index, rotation, crop}` entries — merge and arrange are
   just the order of that list, and nothing is written until you download.
3. **pdf-lib** copies the selected pages into a new document, bakes rotation, applies the crop box,
   and returns bytes. A `Blob` download is the only output — there is no network call anywhere.

`app/vendor/` is committed on purpose: no build step, no CDN requests, so the site can be served from
any static host and cached for offline use.

## Tests

```bash
node scripts/test-app.js        # 19 checks: open, merge, rotate, drag-reorder, delete/undo, crop,
                                # download, split ZIP, image export, text export, images→PDF,
                                # theme, mobile overflow, console errors
node scripts/test-offline.js    # 4 checks: worker installs, controls the page, app boots offline
node scripts/test-file-mode.js  # 5 checks: file:// banner and editor notice
node scripts/shot.js            # landing page across 1440/834/390, light/dark, reduced motion
```

`test-app.js` writes real files: the download is re-opened with pdf-lib to assert page count, baked
rotation and a surviving crop box. All tests run against the same CSP the deployment serves.

**Pre-flight for a deploy** — build the exact upload set and test that, not the dev tree:

```bash
node scripts/simulate-deploy.js
SERVE_ROOT=.deploy-preview PORT=4322 node scripts/serve.js   # in another shell
BASE=http://127.0.0.1:4322 node scripts/test-app.js
BASE=http://127.0.0.1:4322 node scripts/test-offline.js
URL=http://127.0.0.1:4322/ node scripts/shot.js
```

## Regenerate assets

```bash
node scripts/vendor.js             # refresh app/vendor from node_modules
node scripts/make-fixtures.js      # rebuild preview/fixtures/*.pdf (server must be running)
node scripts/make-brand-assets.js  # rebuild the social card + touch icon
```

## Known limits (deliberate, Phase 1)

- **Password-protected PDFs** are rejected with a clear message — unlocking needs the WASM engine (Phase 4).
- **Crop** sets the PDF crop box; content outside it is still in the file.
- **Everything runs on the main thread.** Files up to a few hundred MB work; the UI blocks briefly on
  very large saves. Moving pdf-lib into a worker is the next structural step.
- **No undo stack** beyond the single "page removed" toast.
- **Split** emits one PDF per page or per range; it does not merge ranges into one file.
