/* PDFEdits editor — page model, UI and local pipeline. */
import {
  buildPdf,
  splitRanges,
  imagesToPdf,
  zipFiles,
  parseRanges,
  loadDocument,
} from "./engine.js";
import { openDocument, renderPage, renderToBlob, pageText } from "./viewer.js";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const el = {
  root: document.documentElement,
  themeToggle: $("[data-theme-toggle]"),
  fileInput: $("[data-file-input]"),
  imageInput: $("[data-image-input]"),
  thumbs: $("[data-thumbs]"),
  railEmpty: $("[data-rail-empty]"),
  pageCount: $("[data-page-count]"),
  docName: $("[data-doc-name]"),
  docSub: $("[data-doc-sub]"),
  download: $("[data-download]"),
  status: $("[data-status]"),
  size: $("[data-size]"),
  stageBody: $("[data-stage-body]"),
  canvas: $("[data-canvas]"),
  canvasWrap: $("[data-canvas-wrap]"),
  dropzone: $("[data-dropzone]"),
  stagePage: $("[data-stage-page]"),
  busy: $("[data-busy]"),
  busyText: $("[data-busy-text]"),
  toasts: $("[data-toasts]"),
  cropDialog: $('[data-dialog="crop"]'),
  splitDialog: $('[data-dialog="split"]'),
  imagesDialog: $('[data-dialog="images"]'),
};

const state = {
  docs: new Map(),
  pages: [],
  selected: null,
  docSeq: 1,
  pageSeq: 1,
  busy: false,
};

const libDocs = new Map();
const thumbs = new Map();
let dragId = null;
let dropAfter = true;
let stageToken = 0;

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

function setStatus(message, kind = "info") {
  el.status.textContent = message;
  el.status.classList.toggle("is-error", kind === "error");
}

function toast(message, options = {}) {
  const node = document.createElement("div");
  node.className = "toast" + (options.kind === "error" ? " is-error" : "");
  const text = document.createElement("span");
  text.textContent = message;
  node.append(text);

  if (options.action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = options.action;
    button.addEventListener("click", () => {
      options.onAction?.();
      node.remove();
    });
    node.append(button);
  }

  el.toasts.append(node);
  window.setTimeout(() => node.remove(), options.timeout ?? 4200);
}

function setBusy(busy, message = "Working…") {
  state.busy = busy;
  el.busy.hidden = !busy;
  el.busyText.textContent = message;
  updateControls();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function baseName() {
  const first = state.docs.values().next().value;
  const name = first?.name || "document";
  return name.replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "-").slice(0, 60) || "document";
}

function totalBytes() {
  return state.pages.reduce((sum, page) => sum + (state.docs.get(page.docId)?.bytes.length || 0), 0);
}

function selectedIndex() {
  return state.pages.findIndex((page) => page.id === state.selected);
}

function selectedPage() {
  return state.pages.find((page) => page.id === state.selected) || null;
}

async function docProxy(docId) {
  const doc = state.docs.get(docId);
  if (!doc) throw new Error("That source file is no longer open.");
  return doc.pdf;
}

async function libDoc(docId) {
  if (!libDocs.has(docId)) {
    const doc = state.docs.get(docId);
    if (!doc) throw new Error("That source file is no longer open.");
    libDocs.set(docId, await loadDocument(doc.bytes));
  }
  return libDocs.get(docId);
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

function applyTheme(theme, persist) {
  el.root.dataset.theme = theme;
  if (persist) {
    try { localStorage.setItem("pdfedits-theme", theme); } catch (e) {}
  }
  const dark = theme === "dark";
  el.themeToggle.setAttribute("aria-pressed", String(dark));
  el.themeToggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
}

applyTheme(el.root.dataset.theme === "dark" ? "dark" : "light", false);
el.themeToggle.addEventListener("click", () => {
  applyTheme(el.root.dataset.theme === "dark" ? "light" : "dark", true);
});

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

function updateControls() {
  const hasPages = state.pages.length > 0;
  const hasSelection = Boolean(selectedPage());
  const locked = state.busy;
  const index = selectedIndex();

  el.download.disabled = !hasPages || locked;

  $$("[data-action]").forEach((button) => {
    const action = button.dataset.action;
    const needsPage = ["rotate-left", "rotate-right", "crop", "delete"].includes(action);
    button.disabled = locked || (needsPage ? !hasSelection : !hasPages);
  });

  const earlier = $("[data-action='move-left']");
  const later = $("[data-action='move-right']");
  if (earlier) earlier.disabled = locked || !hasSelection || index <= 0;
  if (later) later.disabled = locked || !hasSelection || index >= state.pages.length - 1;

  const addImages = $("[data-action='add-images']");
  if (addImages) addImages.disabled = locked;
}

function updateChrome() {
  const docs = state.docs.size;
  el.pageCount.textContent = state.pages.length;
  el.railEmpty.hidden = state.pages.length > 0;

  if (!docs) {
    el.docName.textContent = "No document";
    el.docSub.textContent = "Drop a PDF to begin";
    el.size.textContent = "—";
  } else {
    const first = state.docs.values().next().value;
    el.docName.textContent = docs === 1 ? first.name : `${docs} files`;
    el.docSub.textContent = `${state.pages.length} page${state.pages.length === 1 ? "" : "s"}`;
    el.size.textContent = `${state.pages.length} page${state.pages.length === 1 ? "" : "s"} · ${formatBytes(totalBytes())}`;
  }

  const page = selectedPage();
  el.stagePage.textContent = page
    ? `Page ${selectedIndex() + 1} of ${state.pages.length}`
    : "—";

  el.canvasWrap.hidden = !page;
  el.dropzone.hidden = Boolean(page);
  updateControls();
}

/* ------------------------------------------------------------------ */
/* Thumbnails                                                          */
/* ------------------------------------------------------------------ */

const thumbObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const page = state.pages.find((item) => item.id === entry.target.dataset.pageId);
        if (page) drawThumb(page);
      }
    }, { root: el.thumbs, rootMargin: "240px 0px" })
  : null;

function createThumb(page) {
  const li = document.createElement("li");
  li.className = "thumb";
  li.draggable = true;
  li.tabIndex = 0;
  li.setAttribute("role", "option");
  li.dataset.pageId = page.id;
  li.innerHTML = `
    <span class="thumb-index"></span>
    <span class="thumb-frame"><span class="thumb-placeholder"></span></span>
    <span class="thumb-badge" hidden></span>
  `;

  const record = {
    li,
    frame: $(".thumb-frame", li),
    index: $(".thumb-index", li),
    badge: $(".thumb-badge", li),
    canvas: null,
    rendered: false,
    rotation: null,
  };

  li.addEventListener("click", () => select(page.id));
  li.addEventListener("keydown", (event) => onThumbKey(event, page));

  li.addEventListener("dragstart", (event) => {
    dragId = page.id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", page.id);
    li.classList.add("is-dragging");
  });
  li.addEventListener("dragend", () => {
    li.classList.remove("is-dragging");
    clearDropMarks();
  });
  li.addEventListener("dragover", (event) => {
    if (!dragId || dragId === page.id) return;
    event.preventDefault();
    const rect = li.getBoundingClientRect();
    dropAfter = event.clientY > rect.top + rect.height / 2;
    clearDropMarks();
    li.classList.add(dropAfter ? "is-over-after" : "is-over-before");
  });
  li.addEventListener("dragleave", () => {
    li.classList.remove("is-over-before", "is-over-after");
  });
  li.addEventListener("drop", (event) => {
    if (!dragId) return;
    event.preventDefault();
    const sourceId = dragId;
    clearDropMarks();
    dragId = null;
    movePage(sourceId, page.id, dropAfter);
  });

  thumbs.set(page.id, record);
  thumbObserver?.observe(li);
  return record;
}

function clearDropMarks() {
  $$(".thumb").forEach((node) => node.classList.remove("is-over-before", "is-over-after"));
}

async function drawThumb(page) {
  const record = thumbs.get(page.id);
  if (!record) return;
  if (record.rendered && record.rotation === page.rotation) return;

  try {
    const proxy = await docProxy(page.docId);
    const pdfPage = await proxy.getPage(page.index + 1);
    const canvas = record.canvas || document.createElement("canvas");
    await renderPage(pdfPage, canvas, {
      maxWidth: 150,
      maxHeight: 200,
      rotation: page.rotation,
      maxDpr: 2,
    });
    record.canvas = canvas;
    record.rendered = true;
    record.rotation = page.rotation;
    record.frame.replaceChildren(canvas);
  } catch (error) {
    console.warn("thumbnail failed", error);
  }
}

function syncRail() {
  const alive = new Set(state.pages.map((page) => page.id));
  for (const [id, record] of thumbs) {
    if (alive.has(id)) continue;
    thumbObserver?.unobserve(record.li);
    record.li.remove();
    thumbs.delete(id);
  }

  state.pages.forEach((page, index) => {
    const record = thumbs.get(page.id) || createThumb(page);
    record.index.textContent = String(index + 1);
    record.li.setAttribute("aria-posinset", String(index + 1));
    record.li.setAttribute("aria-setsize", String(state.pages.length));
    record.li.setAttribute("aria-selected", String(page.id === state.selected));

    const rotated = page.rotation % 360 !== 0;
    const badge = rotated ? `${((page.rotation % 360) + 360) % 360}°` : page.crop ? "Crop" : "";
    record.badge.hidden = !badge;
    record.badge.textContent = badge;
    record.li.classList.toggle("is-cropped", Boolean(page.crop));
    record.li.classList.toggle("is-selected", page.id === state.selected);

    el.thumbs.append(record.li);

    if (record.rendered && record.rotation !== page.rotation) {
      record.rendered = false;
      if (isVisible(record.li)) drawThumb(page);
    }
  });
}

function isVisible(node) {
  const rect = node.getBoundingClientRect();
  return rect.bottom > -240 && rect.top < window.innerHeight + 240;
}

function onThumbKey(event, page) {  const index = state.pages.findIndex((item) => item.id === page.id);
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    select(page.id);
    return;
  }
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    const delta = event.key === "ArrowUp" ? -1 : 1;
    if (event.altKey || event.metaKey) {
      event.preventDefault();
      moveTo(index, index + delta);
      return;
    }
    event.preventDefault();
    const next = state.pages[index + delta];
    if (next) thumbs.get(next.id)?.li.focus();
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    select(page.id);
    deleteSelected();
  }
}

/* ------------------------------------------------------------------ */
/* Selection + stage                                                   */
/* ------------------------------------------------------------------ */

function select(pageId) {
  state.selected = pageId;
  for (const [id, record] of thumbs) {
    const isSelected = id === pageId;
    record.li.classList.toggle("is-selected", isSelected);
    record.li.setAttribute("aria-selected", String(isSelected));
  }
  updateChrome();
  renderStage();
  const record = thumbs.get(pageId);
  record?.li.scrollIntoView({ block: "nearest" });
}

async function renderStage() {
  const page = selectedPage();
  if (!page) {
    el.canvas.getContext("2d")?.clearRect(0, 0, 1, 1);
    return;
  }

  const token = ++stageToken;
  const rect = el.stageBody.getBoundingClientRect();
  const maxWidth = Math.max(220, rect.width - 48);
  const maxHeight = Math.max(220, rect.height - 48);

  try {
    const proxy = await docProxy(page.docId);
    const pdfPage = await proxy.getPage(page.index + 1);
    if (token !== stageToken) return;
    await renderPage(pdfPage, el.canvas, {
      maxWidth,
      maxHeight,
      rotation: page.rotation,
      maxDpr: 2,
    });
  } catch (error) {
    fail(error);
  }
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

async function addPdfFiles(fileList) {
  const files = Array.from(fileList).filter(
    (file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name)
  );
  if (!files.length) {
    toast("Those files aren't PDFs.", { kind: "error" });
    return;
  }

  setBusy(true, files.length === 1 ? "Opening PDF…" : `Opening ${files.length} PDFs…`);
  await nextPaint();

  try {
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await openDocument(bytes);
      const docId = `d${state.docSeq++}`;
      state.docs.set(docId, { id: docId, name: file.name, bytes, pdf });

      for (let index = 0; index < pdf.numPages; index += 1) {
        state.pages.push({
          id: `p${state.pageSeq++}`,
          docId,
          index,
          rotation: 0,
          crop: null,
        });
      }
    }

    if (!selectedPage()) {
      state.selected = state.pages[0]?.id ?? null;
    }
    syncRail();
    updateChrome();
    await renderStage();
    setStatus(`${files.length} file${files.length === 1 ? "" : "s"} opened · ${state.pages.length} pages`);
  } catch (error) {
    fail(error);
  } finally {
    setBusy(false);
  }
}

async function addImageFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;

  setBusy(true, `Converting ${files.length} image${files.length === 1 ? "" : "s"}…`);
  await nextPaint();

  try {
    const bytes = await imagesToPdf(files);
    const pdf = await openDocument(bytes);
    const docId = `d${state.docSeq++}`;
    state.docs.set(docId, { id: docId, name: "images.pdf", bytes, pdf });

    const firstNew = state.pages.length;
    for (let index = 0; index < pdf.numPages; index += 1) {
      state.pages.push({ id: `p${state.pageSeq++}`, docId, index, rotation: 0, crop: null });
    }
    state.selected = state.pages[firstNew]?.id ?? state.selected;

    syncRail();
    updateChrome();
    await renderStage();
    toast(`${pdf.numPages} image${pdf.numPages === 1 ? "" : "s"} added as pages`);
    setStatus("Images converted to PDF pages");
  } catch (error) {
    fail(error);
  } finally {
    setBusy(false);
  }
}

function fail(error) {
  console.error(error);
  const raw = String(error?.message || error);
  const message = /password/i.test(raw)
    ? "That PDF is password-protected — unlocking isn't available yet."
    : raw;
  setStatus(message, "error");
  toast(message, { kind: "error" });
}

/* ------------------------------------------------------------------ */
/* Page operations                                                     */
/* ------------------------------------------------------------------ */

function movePage(sourceId, targetId, after) {
  const from = state.pages.findIndex((page) => page.id === sourceId);
  const target = state.pages.findIndex((page) => page.id === targetId);
  if (from < 0 || target < 0 || from === target) return;
  const [page] = state.pages.splice(from, 1);
  let to = state.pages.findIndex((item) => item.id === targetId);
  if (after) to += 1;
  state.pages.splice(to, 0, page);
  syncRail();
  updateChrome();
  setStatus(`Moved page to position ${to + 1}`);
}

function moveTo(from, to) {
  if (to < 0 || to >= state.pages.length) return;
  const [page] = state.pages.splice(from, 1);
  state.pages.splice(to, 0, page);
  syncRail();
  updateChrome();
  thumbs.get(page.id)?.li.focus();
  setStatus(`Moved page to position ${to + 1}`);
}

function moveSelection(delta) {
  const index = selectedIndex();
  if (index < 0) return;
  moveTo(index, index + delta);
}

/* ------------------------------------------------------------------ */
/* Touch reordering: long-press a thumbnail, then drag                  */
/* ------------------------------------------------------------------ */

let touchDrag = null;

function thumbsAxisIsRow() {
  return getComputedStyle(el.thumbs).flexDirection === "row";
}

function clearTouchDrag() {
  if (!touchDrag) return;
  window.clearTimeout(touchDrag.timer);
  touchDrag.li.classList.remove("is-lifted");
  clearDropMarks();
  touchDrag = null;
}

function activateTouchDrag() {
  if (!touchDrag) return;
  touchDrag.active = true;
  touchDrag.li.classList.add("is-lifted");
  select(touchDrag.id);
  if (navigator.vibrate) navigator.vibrate(8);
}

function autoScrollThumbs(x, y) {
  const rect = el.thumbs.getBoundingClientRect();
  const edge = 56;
  if (thumbsAxisIsRow()) {
    if (x < rect.left + edge) el.thumbs.scrollLeft -= 16;
    else if (x > rect.right - edge) el.thumbs.scrollLeft += 16;
  } else if (y < rect.top + edge) el.thumbs.scrollTop -= 16;
  else if (y > rect.bottom - edge) el.thumbs.scrollTop += 16;
}

function moveTouchTarget(x, y) {
  if (!touchDrag) return;
  autoScrollThumbs(x, y);

  const row = thumbsAxisIsRow();
  let best = null;
  let bestDistance = Infinity;

  for (const node of el.thumbs.querySelectorAll(".thumb")) {
    if (node.dataset.pageId === touchDrag.id) continue;
    const rect = node.getBoundingClientRect();
    const distance = row
      ? Math.abs(x - (rect.left + rect.width / 2))
      : Math.abs(y - (rect.top + rect.height / 2));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { node, rect };
    }
  }

  clearDropMarks();
  if (!best) {
    touchDrag.targetId = null;
    return;
  }

  const after = row
    ? x > best.rect.left + best.rect.width / 2
    : y > best.rect.top + best.rect.height / 2;

  best.node.classList.add(after ? "is-over-after" : "is-over-before");
  touchDrag.targetId = best.node.dataset.pageId;
  touchDrag.after = after;
}

el.thumbs.addEventListener("touchstart", (event) => {
  if (event.touches.length !== 1) return;
  const li = event.target.closest(".thumb");
  if (!li) return;
  const touch = event.touches[0];
  touchDrag = {
    id: li.dataset.pageId,
    li,
    startX: touch.clientX,
    startY: touch.clientY,
    active: false,
    targetId: null,
    after: true,
    timer: window.setTimeout(activateTouchDrag, 280),
  };
}, { passive: true });

el.thumbs.addEventListener("touchmove", (event) => {
  if (!touchDrag) return;
  const touch = event.touches[0];

  if (!touchDrag.active) {
    if (Math.hypot(touch.clientX - touchDrag.startX, touch.clientY - touchDrag.startY) > 10) {
      clearTouchDrag();
    }
    return;
  }

  event.preventDefault();
  moveTouchTarget(touch.clientX, touch.clientY);
}, { passive: false });

el.thumbs.addEventListener("touchend", () => {
  if (!touchDrag) return;
  const { active, id, targetId, after } = touchDrag;
  clearTouchDrag();
  if (active && targetId) movePage(id, targetId, after);
});

el.thumbs.addEventListener("touchcancel", clearTouchDrag);

el.thumbs.addEventListener("contextmenu", (event) => {
  if (touchDrag) event.preventDefault();
});

function rotateSelected(delta) {
  const page = selectedPage();
  if (!page) return;
  page.rotation = (((page.rotation + delta) % 360) + 360) % 360;
  syncRail();
  updateChrome();
  renderStage();
  setStatus(`Page rotated to ${page.rotation}°`);
}

let deleted = null;

function deleteSelected() {
  const index = selectedIndex();
  if (index < 0) return;
  const [page] = state.pages.splice(index, 1);
  deleted = { page, index };

  const next = state.pages[index] || state.pages[index - 1] || null;
  state.selected = next?.id ?? null;
  syncRail();
  updateChrome();
  renderStage();

  toast("Page removed", {
    action: "Undo",
    timeout: 6000,
    onAction: () => {
      if (!deleted) return;
      state.pages.splice(deleted.index, 0, deleted.page);
      state.selected = deleted.page.id;
      deleted = null;
      syncRail();
      updateChrome();
      renderStage();
      setStatus("Page restored");
    },
  });
  setStatus(`${state.pages.length} page${state.pages.length === 1 ? "" : "s"} left`);
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

$$("[data-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog")?.close());
});

/* ----- Split ----- */
function openSplit() {
  if (!state.pages.length) return;
  const form = $("[data-split-form]");
  form.reset();
  $("[data-range-field]", form).hidden = true;
  openDialog(el.splitDialog);
}

// Delegated: a change event fires on the clicked radio, not on the group.
el.splitDialog?.addEventListener("change", (event) => {
  if (!event.target.matches('input[name="split-mode"]')) return;
  const field = $("[data-range-field]", el.splitDialog);
  field.hidden = event.target.value !== "range";
  if (!field.hidden) field.querySelector("input")?.focus();
});

$("[data-split-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const mode = form.querySelector('input[name="split-mode"]:checked')?.value || "page";
  const close = () => el.splitDialog.close();

  try {
    let ranges;
    if (mode === "page") {
      ranges = state.pages.map((_, index) => ({ start: index + 1, end: index + 1 }));
    } else {
      ranges = parseRanges(form.ranges.value, state.pages.length);
    }

    close();
    setBusy(true, mode === "page" ? "Splitting pages…" : "Extracting ranges…");
    await nextPaint();

    const files = await splitRanges(state.pages, libDoc, ranges);
    const zipped = zipFiles(files);
    downloadBlob(new Blob([zipped], { type: "application/zip" }), `${baseName()}-split.zip`);
    setStatus(`Split into ${files.length} PDF${files.length === 1 ? "" : "s"}`);
    toast(`${files.length} PDF${files.length === 1 ? "" : "s"} downloaded as a ZIP`);
  } catch (error) {
    fail(error);
  } finally {
    setBusy(false);
  }
});

/* ----- Crop ----- */
const cropState = { pageId: null };

async function openCrop() {
  const page = selectedPage();
  if (!page) return;

  cropState.pageId = page.id;
  const form = $("[data-crop-form]");
  const values = page.crop
    ? {
        top: Math.round(page.crop.top * 100),
        right: Math.round(page.crop.right * 100),
        bottom: Math.round(page.crop.bottom * 100),
        left: Math.round(page.crop.left * 100),
      }
    : { top: 0, right: 0, bottom: 0, left: 0 };

  for (const key of ["top", "right", "bottom", "left"]) {
    form.elements[key].value = String(values[key]);
  }
  updateCropShades();

  openDialog(el.cropDialog);
  await nextPaint();

  try {
    const proxy = await docProxy(page.docId);
    const pdfPage = await proxy.getPage(page.index + 1);
    await renderPage(pdfPage, $("[data-crop-canvas]"), {
      maxWidth: 460,
      maxHeight: Math.max(240, window.innerHeight * 0.46),
      rotation: 0,
      maxDpr: 2,
    });
  } catch (error) {
    fail(error);
  }
}

function cropValues() {
  const form = $("[data-crop-form]");
  return {
    top: Number(form.elements.top.value),
    right: Number(form.elements.right.value),
    bottom: Number(form.elements.bottom.value),
    left: Number(form.elements.left.value),
  };
}

function updateCropShades() {
  const values = cropValues();
  const frame = $("[data-crop-frame]");
  if (!frame) return;

  $('[data-shade="top"]').style.height = `${values.top}%`;
  $('[data-shade="bottom"]').style.height = `${values.bottom}%`;
  $('[data-shade="left"]').style.width = `${values.left}%`;
  $('[data-shade="right"]').style.width = `${values.right}%`;
  $('[data-shade="left"]').style.top = `${values.top}%`;
  $('[data-shade="left"]').style.bottom = `${values.bottom}%`;
  $('[data-shade="right"]').style.top = `${values.top}%`;
  $('[data-shade="right"]').style.bottom = `${values.bottom}%`;

  for (const key of ["top", "right", "bottom", "left"]) {
    const output = $(`[data-out="${key}"]`);
    if (output) output.textContent = `${values[key]}%`;
  }
}

$("[data-crop-form]")?.addEventListener("input", (event) => {
  if (event.target.type === "range") updateCropShades();
});

$("[data-crop-reset]")?.addEventListener("click", () => {
  const form = $("[data-crop-form]");
  for (const key of ["top", "right", "bottom", "left"]) form.elements[key].value = "0";
  updateCropShades();
});

$("[data-crop-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const page = state.pages.find((item) => item.id === cropState.pageId);
  if (!page) { el.cropDialog.close(); return; }

  const values = cropValues();
  const sumX = values.left + values.right;
  const sumY = values.top + values.bottom;
  if (sumX >= 95 || sumY >= 95) {
    toast("Leave at least 5% of the page visible.", { kind: "error" });
    return;
  }

  page.crop = sumX === 0 && sumY === 0
    ? null
    : {
        top: values.top / 100,
        right: values.right / 100,
        bottom: values.bottom / 100,
        left: values.left / 100,
      };

  el.cropDialog.close();
  syncRail();
  updateChrome();
  renderStage();
  setStatus(page.crop ? "Crop applied" : "Crop cleared");
});

/* ----- Export images ----- */
function openImages() {
  if (!state.pages.length) return;
  openDialog(el.imagesDialog);
}

$("[data-images-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const format = form.elements.format.value;
  const dpi = Number(form.elements.dpi.value);
  const scope = form.elements.scope.value;
  const pages = scope === "current" ? [selectedPage()].filter(Boolean) : state.pages.slice();
  if (!pages.length) return;

  el.imagesDialog.close();
  setBusy(true, `Rendering ${pages.length} page${pages.length === 1 ? "" : "s"}…`);
  await nextPaint();

  try {
    const files = [];
    const extension = format === "image/png" ? "png" : "jpg";

    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i];
      const proxy = await docProxy(page.docId);
      const pdfPage = await proxy.getPage(page.index + 1);
      const base = pdfPage.getViewport({ scale: 1, rotation: 0 });
      const wanted = dpi / 72;
      const cap = Math.min(wanted, 4200 / Math.max(base.width, base.height));

      const blob = await renderToBlob(pdfPage, {
        scale: cap,
        type: format,
        quality: 0.9,
        rotation: page.rotation,
      });
      files.push({ name: `page-${String(i + 1).padStart(2, "0")}.${extension}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
      el.busyText.textContent = `Rendering page ${i + 1} of ${pages.length}…`;
    }

    const zipped = zipFiles(files);
    downloadBlob(new Blob([zipped], { type: "application/zip" }), `${baseName()}-images.zip`);
    setStatus(`${files.length} image${files.length === 1 ? "" : "s"} exported`);
    toast(`Images downloaded as a ZIP`);
  } catch (error) {
    fail(error);
  } finally {
    setBusy(false);
  }
});

/* ----- Export text ----- */
async function exportText() {
  if (!state.pages.length) return;
  setBusy(true, "Extracting text…");
  await nextPaint();

  try {
    const chunks = [];
    for (let i = 0; i < state.pages.length; i += 1) {
      const page = state.pages[i];
      const proxy = await docProxy(page.docId);
      const pdfPage = await proxy.getPage(page.index + 1);
      const text = await pageText(pdfPage);
      chunks.push(`— Page ${i + 1} —\n\n${text || "(no text layer on this page)"}`);
      el.busyText.textContent = `Reading page ${i + 1} of ${state.pages.length}…`;
    }

    const blob = new Blob([chunks.join("\n\n")], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, `${baseName()}.txt`);
    setStatus("Text exported");
  } catch (error) {
    fail(error);
  } finally {
    setBusy(false);
  }
}

/* ------------------------------------------------------------------ */
/* Download                                                            */
/* ------------------------------------------------------------------ */

async function downloadPdf() {
  if (!state.pages.length) return;
  setBusy(true, "Assembling PDF…");
  await nextPaint();

  try {
    const bytes = await buildPdf(state.pages, libDoc);
    downloadBlob(new Blob([bytes], { type: "application/pdf" }), `${baseName()}-pdfedits.pdf`);
    setStatus(`Saved ${state.pages.length} page${state.pages.length === 1 ? "" : "s"} · ${formatBytes(bytes.length)}`);
    toast("PDF downloaded — assembled in this tab");
  } catch (error) {
    fail(error);
  } finally {
    setBusy(false);
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

$$("[data-add]").forEach((button) => {
  button.addEventListener("click", () => el.fileInput.click());
});

$$("[data-add-images]").forEach((button) => {
  button.addEventListener("click", () => el.imageInput.click());
});

el.fileInput.addEventListener("change", () => {
  if (el.fileInput.files?.length) addPdfFiles(el.fileInput.files);
  el.fileInput.value = "";
});

el.imageInput.addEventListener("change", () => {
  if (el.imageInput.files?.length) addImageFiles(el.imageInput.files);
  el.imageInput.value = "";
});

el.download.addEventListener("click", downloadPdf);

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  switch (button.dataset.action) {
    case "rotate-left": rotateSelected(-90); break;
    case "rotate-right": rotateSelected(90); break;
    case "crop": openCrop(); break;
    case "delete": deleteSelected(); break;
    case "move-left": moveSelection(-1); break;
    case "move-right": moveSelection(1); break;
    case "split": openSplit(); break;
    case "export-images": openImages(); break;
    case "export-text": exportText(); break;
    case "add-images": el.imageInput.click(); break;
    default: break;
  }
});

/* Drag files over the stage */
let dragDepth = 0;

window.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer?.types?.includes("Files")) return;
  dragDepth += 1;
  el.stageBody.classList.add("is-dragover");
});

window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) el.stageBody.classList.remove("is-dragover");
});

window.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
});

window.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  dragDepth = 0;
  el.stageBody.classList.remove("is-dragover");
  const files = Array.from(event.dataTransfer.files);
  const images = files.filter((file) => file.type.startsWith("image/"));
  const pdfs = files.filter((file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name));
  if (pdfs.length) addPdfFiles(pdfs);
  if (images.length) addImageFiles(images);
});

/* Keyboard */
document.addEventListener("keydown", (event) => {
  if (event.target.closest("input, textarea, select, dialog")) return;
  if (document.querySelector("dialog[open]")) return;

  if (event.key === "Delete" || event.key === "Backspace") {
    if (!state.selected) return;
    event.preventDefault();
    deleteSelected();
  } else if (event.key === "r" || event.key === "R") {
    if (!state.selected) return;
    event.preventDefault();
    rotateSelected(event.shiftKey ? -90 : 90);
  } else if (event.key === "ArrowUp" && event.altKey) {
    event.preventDefault();
    moveSelection(-1);
  } else if (event.key === "ArrowDown" && event.altKey) {
    event.preventDefault();
    moveSelection(1);
  }
});

/* Resize */
let resizeTimer = null;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => renderStage(), 160);
});

/* Boot */
updateChrome();
setStatus("Ready");
