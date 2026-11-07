/* pdf.js wrapper: open, render to canvas, extract text. */
import * as pdfjs from "./vendor/pdf.min.mjs";

const VENDOR = new URL("./vendor/", import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = VENDOR + "pdf.worker.min.mjs";

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<import("./vendor/pdf.min.mjs").PDFDocumentProxy>}
 */
export function openDocument(bytes) {
  // pdf.js transfers the buffer it receives, so hand it a copy and keep ours for pdf-lib.
  return pdfjs.getDocument({
    data: bytes.slice(),
    wasmUrl: VENDOR + "wasm/",
    standardFontDataUrl: VENDOR + "standard_fonts/",
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;
}

/**
 * Render a page into a canvas, scaled to fit the given box.
 * @param {any} page
 * @param {HTMLCanvasElement} canvas
 * @param {{maxWidth?:number, maxHeight?:number, scale?:number, rotation?:number, maxDpr?:number}} options
 */
export async function renderPage(page, canvas, options = {}) {
  const { maxWidth = 900, maxHeight = 900, scale, rotation = 0, maxDpr = 2 } = options;
  const angle = (((page.rotate + rotation) % 360) + 360) % 360;
  const base = page.getViewport({ scale: 1, rotation: angle });

  const fit = scale || Math.min(maxWidth / base.width, maxHeight / base.height);
  const viewport = page.getViewport({ scale: fit, rotation: angle });
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

  canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
  canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const context = canvas.getContext("2d", { alpha: false });
  context.save();
  context.scale(dpr, dpr);
  await page.render({ canvasContext: context, viewport }).promise;
  context.restore();

  return viewport;
}

/**
 * Render at an exact scale (used for image export).
 * @returns {Promise<Blob>}
 */
export async function renderToBlob(page, { scale, type = "image/png", quality = 0.92, rotation = 0 }) {
  const angle = (((page.rotate + rotation) % 360) + 360) % 360;
  const viewport = page.getViewport({ scale, rotation: angle });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error("The browser could not encode that image.");
  return blob;
}

/** @returns {Promise<string>} page text with line breaks preserved */
export async function pageText(page) {
  const content = await page.getTextContent();
  let out = "";
  for (const item of content.items) {
    if (typeof item.str !== "string") continue;
    out += item.str;
    if (item.hasEOL) out += "\n";
    else if (!/\s$/.test(item.str)) out += " ";
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export { pdfjs };
