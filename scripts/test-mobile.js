/* Mobile + tablet behaviour: big documents, touch reordering, split ranges. */
const fs = require("node:fs");
const path = require("node:path");
const { unzipSync } = require("fflate");
const { PDFDocument } = require("pdf-lib");
const { launch, sleep } = require("./cdp");

const BASE = process.env.BASE || "http://127.0.0.1:4321";
const FIX = path.resolve("preview/fixtures");
const DOWNLOADS = path.resolve("preview/downloads");
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

async function setInputFiles(chrome, selector, files) {
  const { result } = await chrome.session("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(selector)})`,
  });
  await chrome.session("DOM.setFileInputFiles", { files, objectId: result.objectId });
}

async function waitForDownloaded(extension, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const files = fs.readdirSync(DOWNLOADS).filter((f) => f.endsWith(extension));
    if (files.length) {
      const file = path.join(DOWNLOADS, files[0]);
      await sleep(250);
      if (fs.statSync(file).size > 0) return file;
    }
    await sleep(150);
  }
  throw new Error(`no .${extension} download`);
}

(async () => {
  fs.rmSync(DOWNLOADS, { recursive: true, force: true });
  fs.mkdirSync(DOWNLOADS, { recursive: true });

  const chrome = await launch({ port: 9342, viewport: { width: 390, height: 844 } });
  const { session, evaluate } = chrome;

  await chrome.cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: DOWNLOADS,
    eventsEnabled: true,
  });

  try {
    /* ---------- 100 pages on a phone ---------- */
    await session("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
    });
    await session("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "light" }],
    });
    await chrome.goto(`${BASE}/app/`);
    await setInputFiles(chrome, "[data-file-input]", [path.join(FIX, "large.pdf")]);
    await chrome.waitFor(`document.querySelectorAll('.thumb').length === 100`, { timeout: 30000 });
    await chrome.waitFor(`document.querySelector('[data-busy]').hidden === true`, { timeout: 30000 });
    await sleep(900);

    const layout = JSON.parse(
      await evaluate(`JSON.stringify({
        inner: window.innerWidth,
        scrollW: document.documentElement.scrollWidth,
        railW: Math.round(document.querySelector('.rail').getBoundingClientRect().width),
        canvasW: Math.round(document.querySelector('[data-canvas]').getBoundingClientRect().width),
        thumbs: document.querySelectorAll('.thumb').length
      })`)
    );
    check(
      "100 pages do not widen the phone layout",
      layout.inner === 390 && layout.scrollW === 390 && layout.railW === 390,
      JSON.stringify(layout)
    );
    check("selected page still renders at a readable size", layout.canvasW > 280, `${layout.canvasW}px`);

    await chrome.screenshot(path.join("preview", "app-mobile-large.png"));

    /* ---------- touch reordering ---------- */
    const before = await evaluate(
      `JSON.stringify([...document.querySelectorAll('.thumb')].map((t) => t.dataset.pageId))`
    );

    await evaluate(`(async () => {
      const thumbs = [...document.querySelectorAll('.thumb')];
      const source = thumbs[0];
      const target = thumbs[3];
      const container = document.querySelector('[data-thumbs]');
      const pointFor = (el) => {
        const r = el.getBoundingClientRect();
        return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      };
      const fire = (el, type, point, extra = {}) => {
        const touch = new Touch({ identifier: 1, target: el, clientX: point.clientX, clientY: point.clientY });
        el.dispatchEvent(new TouchEvent(type, {
          bubbles: true, cancelable: true,
          touches: type === 'touchend' ? [] : [touch],
          changedTouches: [touch],
          ...extra
        }));
      };

      const start = pointFor(source);
      fire(source, 'touchstart', start);
      await new Promise((r) => setTimeout(r, 400));
      const finish = pointFor(target);
      fire(container, 'touchmove', { clientX: finish.clientX + 20, clientY: finish.clientY });
      await new Promise((r) => setTimeout(r, 120));
      fire(container, 'touchend', finish);
      return true;
    })()`);
    await sleep(500);

    const after = await evaluate(
      `JSON.stringify([...document.querySelectorAll('.thumb')].map((t) => t.dataset.pageId))`
    );
    check("touch drag reorders pages", before !== after, `${before.slice(0, 40)}… → ${after.slice(0, 40)}…`);

    /* ---------- move buttons ---------- */
    const beforeMove = await evaluate(
      `JSON.stringify([...document.querySelectorAll('.thumb')].map((t) => t.dataset.pageId))`
    );
    await evaluate(`document.querySelector('[data-action="move-left"]').click()`);
    await sleep(300);
    const afterMove = await evaluate(
      `JSON.stringify([...document.querySelectorAll('.thumb')].map((t) => t.dataset.pageId))`
    );
    check("move buttons reorder pages", beforeMove !== afterMove);

    /* ---------- split ranges ---------- */
    await session("Emulation.setDeviceMetricsOverride", {
      width: 1280, height: 860, deviceScaleFactor: 1, mobile: false,
    });
    await chrome.goto(`${BASE}/app/`);
    await setInputFiles(chrome, "[data-file-input]", [path.join(FIX, "report.pdf")]);
    await chrome.waitFor(`document.querySelectorAll('.thumb').length === 4`);
    await chrome.waitFor(`document.querySelector('[data-busy]').hidden === true`);
    await sleep(400);

    await evaluate(`document.querySelector('[data-action="split"]').click()`);
    await sleep(350);
    await evaluate(`(() => {
      const form = document.querySelector('[data-split-form]');
      form.querySelector('input[value="range"]').click();
      return true;
    })()`);
    await sleep(250);

    const rangeVisible = await evaluate(
      `(() => { const f = document.querySelector('[data-range-field]'); return !f.hidden && f.getBoundingClientRect().height > 0; })()`
    );
    check("choosing Page ranges reveals the textbox", rangeVisible === true);

    await evaluate(`(() => {
      const form = document.querySelector('[data-split-form]');
      form.elements.ranges.value = '2-3';
      form.requestSubmit();
      return true;
    })()`);

    const zipFile = await waitForDownloaded(".zip");
    const entries = unzipSync(new Uint8Array(fs.readFileSync(zipFile)));
    const names = Object.keys(entries);
    const pdf = await PDFDocument.load(entries[names[0]]);
    check(
      "range split produces one PDF for that range",
      names.length === 1 && pdf.getPageCount() === 2,
      `${names.join(", ")} · ${pdf.getPageCount()} pages`
    );

    /* ---------- tablet, 100 pages ---------- */
    await session("Emulation.setDeviceMetricsOverride", {
      width: 820, height: 1180, deviceScaleFactor: 2, mobile: true,
    });
    await chrome.goto(`${BASE}/app/`);
    await setInputFiles(chrome, "[data-file-input]", [path.join(FIX, "large.pdf")]);
    await chrome.waitFor(`document.querySelectorAll('.thumb').length === 100`, { timeout: 30000 });
    await sleep(1000);
    const tablet = JSON.parse(
      await evaluate(`JSON.stringify({
        inner: window.innerWidth,
        scrollW: document.documentElement.scrollWidth,
        canvasW: Math.round(document.querySelector('[data-canvas]').getBoundingClientRect().width)
      })`)
    );
    check("tablet keeps the 100-page layout intact", tablet.inner === 820 && tablet.scrollW === 820, JSON.stringify(tablet));
    await chrome.screenshot(path.join("preview", "app-tablet-large.png"));
  } catch (error) {
    check("mobile run", false, error.message);
    console.error(error);
  } finally {
    await chrome.close();
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exitCode = 1;
})();
