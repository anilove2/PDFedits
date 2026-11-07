/* Renders the social image and touch icon from the preview/og templates. */
const fs = require("node:fs");
const path = require("node:path");
const { launch } = require("./cdp");

const BASE = process.env.BASE || "http://127.0.0.1:4321";
const OUT = path.resolve("assets");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const chrome = await launch({ port: 9339, viewport: { width: 1200, height: 630 } });

  try {
    await chrome.goto(`${BASE}/preview/og/og.html`);
    await chrome.waitFor(`document.fonts.status === 'loaded'`);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const og = await chrome.session("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, "og-image.png"), Buffer.from(og.data, "base64"));
    console.log("og-image.png", (fs.statSync(path.join(OUT, "og-image.png")).size / 1024).toFixed(0), "KB");

    await chrome.session("Emulation.setDeviceMetricsOverride", {
      width: 180,
      height: 180,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await chrome.goto(`${BASE}/preview/og/icon.html`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const icon = await chrome.session("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, "apple-touch-icon.png"), Buffer.from(icon.data, "base64"));
    console.log("apple-touch-icon.png", (fs.statSync(path.join(OUT, "apple-touch-icon.png")).size / 1024).toFixed(0), "KB");
  } finally {
    await chrome.close();
  }
})();
