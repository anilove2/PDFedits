/* pdf-lib operations. Everything runs in this tab — no network, no server. */
import { PDFDocument, degrees } from "./vendor/pdf-lib.min.js";
import { zipSync } from "./vendor/fflate.mjs";

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 24;

/** @param {Uint8Array} bytes */
export function loadDocument(bytes) {
  return PDFDocument.load(bytes);
}

/**
 * Build a PDF from page entries.
 * @param {Array<{docId:string,index:number,rotation?:number,crop?:object}>} entries
 * @param {(docId:string) => Promise<PDFDocument>} getDoc cached source loader
 * @returns {Promise<Uint8Array>}
 */
export async function buildPdf(entries, getDoc) {
  if (!entries.length) throw new Error("No pages to save.");

  const out = await PDFDocument.create();
  const cache = new Map();

  for (const entry of entries) {
    let src = cache.get(entry.docId);
    if (!src) {
      src = await getDoc(entry.docId);
      cache.set(entry.docId, src);
    }

    const [page] = await out.copyPages(src, [entry.index]);
    const base = page.getRotation().angle || 0;
    page.setRotation(degrees(((base + (entry.rotation || 0)) % 360 + 360) % 360));
    if (entry.crop) applyCrop(page, entry.crop);
    out.addPage(page);
  }

  const now = new Date();
  out.setProducer("PDFEdits");
  out.setCreator("PDFEdits — processed locally");
  out.setCreationDate(now);
  out.setModificationDate(now);

  return out.save({ useObjectStreams: true });
}

/** @param {import("./vendor/pdf-lib.min.js").PDFPage} page */
function applyCrop(page, crop) {
  const { width, height } = page.getSize();
  const x = crop.left * width;
  const y = crop.bottom * height;
  const w = width * (1 - crop.left - crop.right);
  const h = height * (1 - crop.top - crop.bottom);
  page.setCropBox(x, y, Math.max(4, w), Math.max(4, h));
}

/**
 * Split into one PDF per range (1-based, inclusive).
 * @returns {Promise<{name:string, bytes:Uint8Array}[]>}
 */
export async function splitRanges(entries, getDoc, ranges) {
  const files = [];
  for (const range of ranges) {
    const slice = entries.slice(range.start - 1, range.end);
    if (!slice.length) continue;
    const bytes = await buildPdf(slice, getDoc);
    const label = range.start === range.end ? `page-${range.start}` : `pages-${range.start}-${range.end}`;
    files.push({ name: `${label}.pdf`, bytes });
  }
  return files;
}

/**
 * Turn images into a single PDF (one page per image, A4-fit, orientation follows the image).
 * @param {File[]} files
 */
export async function imagesToPdf(files) {
  const out = await PDFDocument.create();

  for (const file of files) {
    const image = await embedImage(out, file);
    if (!image) continue;

    const landscape = image.width > image.height;
    const pageW = landscape ? A4.h : A4.w;
    const pageH = landscape ? A4.w : A4.h;
    const scale = Math.min((pageW - MARGIN * 2) / image.width, (pageH - MARGIN * 2) / image.height, 1);
    const w = image.width * scale;
    const h = image.height * scale;

    const page = out.addPage([pageW, pageH]);
    page.drawImage(image, {
      x: (pageW - w) / 2,
      y: (pageH - h) / 2,
      width: w,
      height: h,
    });
  }

  if (!out.getPageCount()) throw new Error("No readable images were selected.");
  out.setProducer("PDFEdits");
  out.setCreator("PDFEdits — processed locally");
  return out.save({ useObjectStreams: true });
}

async function embedImage(doc, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPng = file.type === "image/png" || /\.png$/i.test(file.name);
  try {
    return isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch (error) {
    // WebP, AVIF or anything else the browser can decode: transcode through a canvas.
    const jpeg = await transcodeToJpeg(file);
    return jpeg ? doc.embedJpg(jpeg) : null;
  }
}

async function transcodeToJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** @param {{name:string, bytes:Uint8Array}[]} files */
export function zipFiles(files) {
  const entries = {};
  for (const file of files) entries[file.name] = file.bytes;
  return zipSync(entries, { level: 0 });
}

/**
 * Parse "1-3, 5, 8-10" into inclusive ranges within [1, max].
 * @returns {{start:number,end:number}[]}
 */
export function parseRanges(input, max) {
  const ranges = [];
  for (const part of String(input).split(",")) {
    const token = part.trim();
    if (!token) continue;
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) throw new Error(`Can't read "${token}". Use numbers like 1-3, 5.`);
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (start < 1 || end < start) throw new Error(`Range "${token}" is not valid.`);
    if (start > max) throw new Error(`Range "${token}" starts after page ${max}.`);
    ranges.push({ start, end: Math.min(end, max) });
  }
  if (!ranges.length) throw new Error("Add at least one page range.");
  return ranges;
}
