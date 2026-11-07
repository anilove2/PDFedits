/* Verifies the file:// fallbacks: landing banner and editor notice. */
const path = require("node:path");
const { launch } = require("./cdp");

const ROOT = path.resolve(".").replace(/\\/g, "/");
const FILE = (rel) => `file:///${ROOT}/${rel}`;

(async () => {
  const chrome = await launch({ port: 9338, viewport: { width: 1280, height: 820 } });
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push(ok);
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  };

  try {
    await chrome.goto(FILE("index.html"));
    await chrome.waitFor(`document.readyState === 'complete'`);
    const landing = await chrome.evaluate(`JSON.stringify({
      bannerHidden: document.getElementById('file-banner').hidden,
      isFile: document.documentElement.classList.contains('is-file'),
      title: document.title
    })`);
    const l = JSON.parse(landing);
    check("landing shows the file:// banner", l.bannerHidden === false && l.isFile === true);
    check("title keeps its em dash", l.title.includes("—"), l.title);
    await chrome.screenshot(path.join("preview", "file-landing.png"));

    await chrome.goto(FILE("app/index.html"));
    await chrome.waitFor(`document.readyState === 'complete'`);
    const app = await chrome.evaluate(`JSON.stringify({
      noticeHidden: document.getElementById('file-notice').hidden,
      topbar: getComputedStyle(document.querySelector('.topbar')).display,
      message: document.querySelector('.file-notice h1')?.textContent
    })`);
    const a = JSON.parse(app);
    check("editor explains the file:// limitation", a.noticeHidden === false);
    check("editor chrome is hidden", a.topbar === "none", a.topbar);
    check("notice names the fix", /local server/i.test(a.message || ""), a.message);
    await chrome.screenshot(path.join("preview", "file-app.png"));
  } finally {
    await chrome.close();
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exitCode = 1;
})();
