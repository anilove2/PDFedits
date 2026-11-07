/* End-to-end smoke test for the editor: open, merge, rotate, reorder, crop, download, split, export. */
const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument } = require("pdf-lib");
const { unzipSync } = require("fflate");
const { launch, sleep } = require("./cdp");

const BASE = process.env.BASE || "http://127.0.0.1:4321";
const FIX = path.resolve("preview/fixtures");
const DOWNLOADS = path.resolve("preview/downloads");
const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function setInputFiles(chrome, selector, files) {
  const { result } = await chrome.session("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(selector)})`,
  });
  await chrome.session("DOM.setFileInputFiles", { files, objectId: result.objectId });
}

async function waitForDownloaded(extension, { timeout = 20000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const files = fs.readdirSync(DOWNLOADS).filter((file) => file.endsWith(extension));
    if (files.length) {
      const file = path.join(DOWNLOADS, files[0]);
      const stable = fs.statSync(file).size;
      await sleep(250);
      if (fs.statSync(file).size === stable && stable > 0) return file;
    }
    await sleep(150);
  }
  throw new Error(`No .${extension} download appeared`);
}

(async () => {
  fs.rmSync(DOWNLOADS, { recursive: true, force: true });
  fs.mkdirSync(DOWNLOADS, { recursive: true });

  const chrome = await launch({ port: 9335, viewport: { width: 1440, height: 900 } });
  const { cdp, session, evaluate } = chrome;

  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: DOWNLOADS,
    eventsEnabled: true,
  });

  await session("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });

  try {
    await chrome.goto(`${BASE}/app/`);
    await chrome.waitFor(`document.querySelector('[data-dropzone]') && document.readyState === 'complete'`);
    check("app shell loads", await evaluate(`Boolean(document.querySelector('.topbar'))`));
    await chrome.screenshot(path.join("preview/app-empty.png"));

    /* ---- open report.pdf (4 pages) ---- */
    await setInputFiles(chrome, "[data-file-input]", [path.join(FIX, "report.pdf")]);
    await chrome.waitFor(`document.querySelectorAll('.thumb').length === 4`);
    check("opens 4-page PDF", (await evaluate(`document.querySelectorAll('.thumb').length`)) === 4);
    await chrome.waitFor(`document.querySelector('[data-busy]').hidden === true`);
    await chrome.waitFor(`document.querySelector('[data-canvas]').width > 200`);
    await sleep(500);
    await chrome.screenshot(path.join("preview/app-desktop.png"));

    /* ---- append annex.pdf (2 pages) → merge ---- */
    await setInputFiles(chrome, "[data-file-input]", [path.join(FIX, "annex.pdf")]);
    await chrome.waitFor(`document.querySelectorAll('.thumb').length === 6`);
    check("merges a second file", (await evaluate(`document.querySelectorAll('.thumb').length`)) === 6);

    /* ---- rotate ---- */
    await evaluate(`document.querySelector('[data-action="rotate-right"]').click()`);
    await chrome.waitFor(`document.querySelector('.thumb').classList.contains('is-selected')`);
    await sleep(350);
    check(
      "rotates selected page",
      (await evaluate(`document.querySelector('.thumb.is-selected .thumb-badge')?.textContent`)) === "90°"
    );

    /* ---- drag page 1 after page 2 ---- */
    await evaluate(`(() => {
      const thumbs = [...document.querySelectorAll('.thumb')];
      const dt = new DataTransfer();
      const first = thumbs[0], second = thumbs[1];
      first.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const rect = second.getBoundingClientRect();
      const y = rect.top + rect.height * 0.8;
      second.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientY: y }));
      second.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientY: y }));
      first.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      return true;
    })()`);
    await sleep(400);
    const badgeOrder = await evaluate(
      `[...document.querySelectorAll('.thumb .thumb-badge')].map(b => b.hidden ? '' : b.textContent)`
    );
    check("reorders by drag (rotated page moved to slot 2)", badgeOrder[0] === "" && badgeOrder[1] === "90°", JSON.stringify(badgeOrder));

    /* ---- delete + undo ---- */
    await evaluate(`document.querySelector('[data-action="delete"]').click()`);
    await sleep(300);
    check("deletes a page", (await evaluate(`document.querySelectorAll('.thumb').length`)) === 5);
    await evaluate(`document.querySelector('.toast button')?.click()`);
    await sleep(400);
    check("undo restores the page", (await evaluate(`document.querySelectorAll('.thumb').length`)) === 6);

    /* ---- crop the selected page ---- */
    await evaluate(`document.querySelector('[data-action="crop"]').click()`);
    await sleep(600);
    await chrome.screenshot(path.join("preview/app-crop.png"));
    await evaluate(`(() => {
      const form = document.querySelector('[data-crop-form]');
      for (const [key, value] of Object.entries({ top: 10, bottom: 10, left: 6, right: 6 })) {
        form.elements[key].value = String(value);
        form.elements[key].dispatchEvent(new Event('input', { bubbles: true }));
      }
      form.requestSubmit();
      return true;
    })()`);
    await chrome.waitFor(`document.querySelectorAll('.thumb.is-cropped').length === 1`);
    check("applies a crop", (await evaluate(`document.querySelectorAll('.thumb.is-cropped').length`)) === 1);

    /* ---- download assembled PDF ---- */
    await evaluate(`document.querySelector('[data-download]').click()`);
    const pdfFile = await waitForDownloaded(".pdf");
    const bytes = fs.readFileSync(pdfFile);
    const pdf = await PDFDocument.load(bytes);
    check("downloads an assembled PDF", bytes.subarray(0, 5).toString() === "%PDF-", `${(bytes.length / 1024).toFixed(1)} KB`);
    check("output keeps every page", pdf.getPageCount() === 6, `${pdf.getPageCount()} pages`);

    const rotations = pdf.getPages().map((page) => page.getRotation().angle);
    check("rotation is baked in", rotations.includes(90), JSON.stringify(rotations));

    const cropped = pdf.getPages().filter((page) => {
      const box = page.getCropBox();
      const media = page.getMediaBox();
      return Math.abs(box.width - media.width) > 1 || Math.abs(box.height - media.height) > 1;
    });
    check("crop survives the save", cropped.length === 1, `${cropped.length} cropped page(s)`);

    /* ---- split into pages ---- */
    fs.rmSync(DOWNLOADS, { recursive: true, force: true });
    fs.mkdirSync(DOWNLOADS, { recursive: true });
    await evaluate(`document.querySelector('[data-action="split"]').click()`);
    await sleep(300);
    await evaluate(`document.querySelector('[data-split-form]').requestSubmit()`);
    const zipFile = await waitForDownloaded(".zip");
    const entries = unzipSync(new Uint8Array(fs.readFileSync(zipFile)));
    check("splits into one PDF per page", Object.keys(entries).length === 6, Object.keys(entries).join(", "));

    /* ---- export one page as an image ---- */
    fs.rmSync(DOWNLOADS, { recursive: true, force: true });
    fs.mkdirSync(DOWNLOADS, { recursive: true });
    await evaluate(`document.querySelector('[data-action="export-images"]').click()`);
    await sleep(300);
    await evaluate(`(() => {
      const form = document.querySelector('[data-images-form]');
      form.elements.scope.value = 'current';
      form.elements.dpi.value = '96';
      form.requestSubmit();
      return true;
    })()`);
    const imagesZip = await waitForDownloaded(".zip");
    const imageEntries = unzipSync(new Uint8Array(fs.readFileSync(imagesZip)));
    const imageKeys = Object.keys(imageEntries);
    check("exports a PNG for the selected page", imageKeys.length === 1 && imageKeys[0].endsWith(".png"), imageKeys.join(", "));

    /* ---- export text ---- */
    fs.rmSync(DOWNLOADS, { recursive: true, force: true });
    fs.mkdirSync(DOWNLOADS, { recursive: true });
    await evaluate(`document.querySelector('[data-action="export-text"]').click()`);
    const textFile = await waitForDownloaded(".txt");
    const text = fs.readFileSync(textFile, "utf8");
    check("extracts a real text layer", /Quarterly operations report/i.test(text), `${text.length} chars`);

    /* ---- images → PDF ---- */
    await setInputFiles(chrome, "[data-image-input]", [path.join(FIX, "photo.png")]);
    await chrome.waitFor(`document.querySelectorAll('.thumb').length === 7`);
    check("converts an image into a page", (await evaluate(`document.querySelectorAll('.thumb').length`)) === 7);

    /* ---- persistence of theme ---- */
    await evaluate(`document.querySelector('[data-theme-toggle]').click()`);
    await sleep(250);
    check("theme toggles", (await evaluate(`document.documentElement.dataset.theme`)) === "dark");
    await chrome.screenshot(path.join("preview/app-dark.png"));

    /* ---- mobile layout ---- */
    await session("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await evaluate(`document.querySelector('[data-theme-toggle]').click()`);
    await sleep(700);
    await chrome.screenshot(path.join("preview/app-mobile.png"));
    check(
      "no horizontal overflow on mobile",
      (await evaluate(`document.documentElement.scrollWidth - window.innerWidth`)) === 0
    );

    /* ---- no runtime errors ---- */
    const problems = chrome.problems.filter((line) => !/favicon/i.test(line));
    check("no console errors", problems.length === 0, problems.slice(0, 3).join(" | "));
  } catch (error) {
    check("test run", false, error.message);
    console.error(error);
  } finally {
    await chrome.close();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
})();
