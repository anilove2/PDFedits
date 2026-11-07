/* Proves the offline claim: service worker installs, then the editor boots with the network off. */
const path = require("node:path");
const { launch, sleep } = require("./cdp");

const BASE = process.env.BASE || "http://127.0.0.1:4321";
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

(async () => {
  const chrome = await launch({ port: 9340, viewport: { width: 1280, height: 860 } });
  const { session, evaluate } = chrome;

  try {
    await chrome.goto(`${BASE}/app/`);
    await chrome.waitFor(`document.querySelector('[data-dropzone]')`);

    const registered = await evaluate(`navigator.serviceWorker.ready.then(() => true)`).catch(() => false);
    check("service worker installs", registered === true);
    await sleep(1200);

    const controlled = await evaluate(`Boolean(navigator.serviceWorker.controller)`);
    check("page is controlled by the worker", controlled === true);

    await session("Network.enable");
    await session("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: "none",
    });

    const loaded = new Promise((resolve) => {
      const listener = (message) => {
        if (message.method !== "Page.loadEventFired") return;
        chrome.cdp.off(listener);
        resolve();
      };
      chrome.cdp.on(listener);
      setTimeout(resolve, 8000);
    });
    await session("Page.reload", { ignoreCache: false });
    await loaded;
    await sleep(800);

    const state = await evaluate(`JSON.stringify({
      shell: Boolean(document.querySelector('.topbar')),
      dropzoneVisible: !document.querySelector('[data-dropzone]').hidden,
      theme: document.documentElement.dataset.theme,
      appLoaded: typeof document.querySelector('[data-download]').onclick !== 'undefined'
    })`);
    const parsed = JSON.parse(state);
    check("editor shell renders offline", parsed.shell === true && parsed.dropzoneVisible === true);

    // The theme toggle handler lives in app.js, so this proves the module came from cache.
    const before = await evaluate(`document.documentElement.dataset.theme`);
    await evaluate(`document.querySelector('[data-theme-toggle]').click()`);
    await sleep(250);
    const after = await evaluate(`document.documentElement.dataset.theme`);
    check("app.js executes from cache", before !== after, `${before} -> ${after}`);

    await chrome.screenshot(path.join("preview", "app-offline.png"));

    await session("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: "none",
    });
  } catch (error) {
    check("offline run", false, error.message);
    console.error(error);
  } finally {
    await chrome.close();
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exitCode = 1;
})();
