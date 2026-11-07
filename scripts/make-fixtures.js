/* Prints the fixture HTML files to real PDFs through headless Chrome. */
const fs = require("node:fs");
const path = require("node:path");
const { launch } = require("./cdp");

const BASE = process.env.BASE || "http://127.0.0.1:4321";
const OUT = path.resolve("preview/fixtures");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const chrome = await launch({ port: 9334, viewport: { width: 900, height: 1200 } });

  try {
    for (const name of ["report", "annex"]) {
      await chrome.goto(`${BASE}/preview/fixtures/${name}.html`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const { data } = await chrome.session("Page.printToPDF", {
        printBackground: true,
        preferCSSPageSize: true,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
      });
      const file = path.join(OUT, `${name}.pdf`);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      console.log(`${name}.pdf`, (fs.statSync(file).size / 1024).toFixed(1), "KB");
    }

    // A photo-like PNG for the images-to-PDF path.
    await chrome.goto(`${BASE}/preview/fixtures/photo.html`);
    const { data } = await chrome.session("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, "photo.png"), Buffer.from(data, "base64"));
    console.log("photo.png", (fs.statSync(path.join(OUT, "photo.png")).size / 1024).toFixed(1), "KB");

    if (chrome.problems.length) console.log("problems:", chrome.problems);
  } finally {
    await chrome.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
