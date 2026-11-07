/* Diagnoses the editor with a 100-page PDF on phone and tablet viewports. */
const path = require("node:path");
const fs = require("node:fs");
const { launch, sleep } = require("./cdp");

const BASE = process.env.BASE || "http://127.0.0.1:4321";
const FIX = path.resolve("preview/fixtures");
const OUT = path.resolve("preview");

async function setInputFiles(chrome, selector, files) {
  const { result } = await chrome.session("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(selector)})`,
  });
  await chrome.session("DOM.setFileInputFiles", { files, objectId: result.objectId });
}

(async () => {
  const chrome = await launch({ port: 9341, viewport: { width: 390, height: 844 } });
  const { session, evaluate } = chrome;

  try {
    for (const device of [
      { name: "phone", width: 390, height: 844, dpr: 3, mobile: true },
      { name: "tablet", width: 820, height: 1180, dpr: 2, mobile: true },
      { name: "desktop", width: 1440, height: 900, dpr: 1, mobile: false },
    ]) {
      await session("Emulation.setDeviceMetricsOverride", {
        width: device.width,
        height: device.height,
        deviceScaleFactor: device.dpr,
        mobile: device.mobile,
      });
      await session("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: "light" }],
      });
      await chrome.goto(`${BASE}/app/`);
      await setInputFiles(chrome, "[data-file-input]", [path.join(FIX, "large.pdf")]);
      await chrome.waitFor(`document.querySelectorAll('.thumb').length === 100`, { timeout: 30000 });
      await chrome.waitFor(`document.querySelector('[data-busy]').hidden === true`, { timeout: 30000 });
      await sleep(1200);

      const metrics = JSON.parse(
        await evaluate(`(() => {
          const r = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const b = el.getBoundingClientRect();
            return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
          };
          const canvas = document.querySelector('[data-canvas]');
          return JSON.stringify({
            inner: [window.innerWidth, window.innerHeight],
            dpr: window.devicePixelRatio,
            scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
            body: r('body'),
            rail: r('.rail'),
            stage: r('.stage'),
            stageBody: r('.stage-body'),
            wrap: r('[data-canvas-wrap]'),
            canvas: r('[data-canvas]'),
            canvasAttr: canvas ? [canvas.width, canvas.height] : null,
            canvasStyle: canvas ? [canvas.style.width, canvas.style.height] : null,
            thumbs: document.querySelectorAll('.thumb').length,
            visibleThumbs: [...document.querySelectorAll('.thumb')].filter(t => {
              const b = t.getBoundingClientRect();
              return b.width > 0 && b.right > 0 && b.left < window.innerWidth;
            }).length
          });
        })()`)
      );
      console.log(device.name, JSON.stringify(metrics, null, 2));
      await chrome.screenshot(path.join(OUT, `diag-${device.name}.png`));
    }
  } catch (error) {
    console.error("FAILED", error);
  } finally {
    await chrome.close();
  }
})();
