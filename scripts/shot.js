/* Headless Chrome screenshot + smoke test driver (CDP, no dependencies). */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333;
const BASE = process.env.URL || "http://127.0.0.1:4321/";
const OUT = path.resolve("preview");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(fn) {
    this.listeners.add(fn);
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = path.resolve(".preview-profile");
  fs.rmSync(profile, { recursive: true, force: true });

  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let version = null;
  for (let i = 0; i < 80 && !version; i += 1) {
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    } catch (e) {
      await sleep(150);
    }
  }
  if (!version) throw new Error("chrome did not start");

  const cdp = await CDP.connect(version.webSocketDebuggerUrl);
  const problems = [];
  cdp.on((msg) => {
    if (msg.method === "Runtime.exceptionThrown") {
      problems.push("exception: " + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text));
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      problems.push("console.error: " + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      problems.push("log: " + msg.params.entry.text + " " + (msg.params.entry.url || ""));
    }
    if (msg.method === "Page.javascriptDialogOpening") {
      problems.push("dialog: " + msg.params.message);
    }
  });

  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

  const session = (method, params) => cdp.send(method, params, sessionId);
  await session("Page.enable");
  await session("Runtime.enable");
  await session("Log.enable");

  const shots = [
    { name: "desktop", width: 1440, height: 940, full: true, scheme: "light" },
    { name: "desktop-dark", width: 1440, height: 940, full: true, scheme: "dark" },
    { name: "mobile", width: 390, height: 844, full: true, scheme: "light", mobile: true },
    { name: "tablet", width: 834, height: 1112, full: true, scheme: "light", mobile: true },
  ];

  const report = {};

  for (const shot of shots) {
    await session("Emulation.setDeviceMetricsOverride", {
      width: shot.width,
      height: shot.height,
      deviceScaleFactor: 1,
      mobile: Boolean(shot.mobile),
    });
    await session("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: shot.scheme },
        { name: "prefers-reduced-motion", value: "no-preference" },
      ],
    });

    const loaded = new Promise((resolve) => {
      const handler = (msg) => {
        if (msg.method === "Page.loadEventFired") {
          cdp.listeners.delete(handler);
          resolve();
        }
      };
      cdp.on(handler);
      setTimeout(resolve, 8000);
    });

    await session("Page.navigate", { url: BASE });
    await loaded;
    await sleep(1400);

    // Walk the page so IntersectionObserver reveals run, then return to the top.
    if (shot.full) {
      await session("Runtime.evaluate", {
        expression: `(async () => {
          const doc = document.documentElement;
          const prev = doc.style.scrollBehavior;
          doc.style.scrollBehavior = 'auto';
          const step = Math.round(window.innerHeight * 0.7);
          for (let y = 0; y < doc.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 90));
          }
          window.scrollTo(0, 0);
          await new Promise((r) => setTimeout(r, 900));
          doc.style.scrollBehavior = prev;
        })()`,
        awaitPromise: true,
      });
    }

    const metrics = await session("Page.getLayoutMetrics");
    const content = metrics.cssContentSize;
    const height = Math.ceil(content.height);
    const clip = { x: 0, y: 0, width: shot.width, height: shot.full ? height : shot.height, scale: 1 };

    const { data } = await session("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: Boolean(shot.full),
      clip,
    });

    const file = path.join(OUT, `${shot.name}.png`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));

    const evalRes = await session("Runtime.evaluate", {
      expression: `(() => {
        const q = (s) => document.querySelectorAll(s).length;
        const doc = document.documentElement;
        return JSON.stringify({
          tools: q('[data-tool-grid] .tool'),
          visibleTools: [...document.querySelectorAll('[data-tool-grid] .tool')].filter(el => !el.hidden).length,
          reveals: q('[data-reveal]'),
          revealed: q('[data-reveal].is-visible'),
          fontLoaded: document.fonts.check('16px "Plus Jakarta Sans"'),
          horizontalOverflow: doc.scrollWidth - window.innerWidth,
          pageHeight: Math.round(doc.getBoundingClientRect().height),
          theme: doc.dataset.theme
        });
      })()`,
      returnByValue: true,
    });

    report[shot.name] = {
      file,
      width: shot.width,
      height,
      ...JSON.parse(evalRes.result.value),
    };
    console.log(shot.name, file, `${shot.width}x${height}`);
  }

  // ---------- interaction checks ----------
  const evalJson = async (expression) => {
    const res = await session("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return res.result.value ? JSON.parse(res.result.value) : null;
  };

  await session("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await session("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await session("Page.navigate", { url: BASE });
  await sleep(1200);

  report.filter = await evalJson(`(async () => {
    document.querySelector('[data-filter="secure"]').click();
    await new Promise((r) => setTimeout(r, 400));
    const cards = [...document.querySelectorAll('[data-tool-grid] .tool')];
    const visible = cards.filter((t) => !t.hidden);
    return JSON.stringify({
      visible: visible.length,
      categories: [...new Set(visible.map((t) => t.dataset.cat))],
      pressed: document.querySelector('[data-filter="secure"]').getAttribute('aria-pressed'),
      status: document.querySelector('[data-filter-status]').textContent.trim()
    });
  })()`);

  report.theme = await evalJson(`(async () => {
    const btn = document.querySelector('[data-theme-toggle]');
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    const dark = document.documentElement.dataset.theme;
    const pressed = btn.getAttribute('aria-pressed');
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    return JSON.stringify({ afterClick: dark, pressed, restored: document.documentElement.dataset.theme, stored: localStorage.getItem('pdfedits-theme') });
  })()`);

  report.faq = await evalJson(`(async () => {
    const item = document.querySelector('.faq-item');
    item.querySelector('summary').click();
    await new Promise((r) => setTimeout(r, 250));
    const opened = item.open;
    const answerHeight = item.querySelector('.faq-answer').getBoundingClientRect().height;
    return JSON.stringify({ opened, answerHeight: Math.round(answerHeight) });
  })()`);

  report.smallViewport = await (async () => {
    await session("Emulation.setDeviceMetricsOverride", { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
    await session("Page.navigate", { url: BASE });
    await sleep(900);
    return evalJson(`JSON.stringify({ overflow: document.documentElement.scrollWidth - window.innerWidth })`);
  })();

  report.mobileMenu = await (async () => {
    await session("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await session("Page.navigate", { url: BASE });
    await sleep(900);
    return evalJson(`(async () => {
      const btn = document.querySelector('[data-menu-toggle]');
      const menu = document.querySelector('[data-menu]');
      btn.click();
      await new Promise((r) => setTimeout(r, 200));
      const opened = { expanded: btn.getAttribute('aria-expanded'), hidden: menu.hidden, links: menu.querySelectorAll('a').length };
      btn.click();
      await new Promise((r) => setTimeout(r, 200));
      return JSON.stringify({ opened, closed: { expanded: btn.getAttribute('aria-expanded'), hidden: menu.hidden } });
    })()`);
  })();

  // Reduced-motion pass: everything must be visible with no animation.
  await session("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await session("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-motion", value: "reduce" },
      { name: "prefers-color-scheme", value: "light" },
    ],
  });
  await session("Page.navigate", { url: BASE });
  await sleep(1200);
  const rm = await session("Runtime.evaluate", {
    expression: `(() => {
      const hidden = [...document.querySelectorAll('[data-reveal]')].filter(el => getComputedStyle(el).opacity === '0').length;
      const counters = [...document.querySelectorAll('[data-count]')].map(el => el.textContent);
      return JSON.stringify({ hiddenReveals: hidden, counters });
    })()`,
    returnByValue: true,
  });
  report.reducedMotion = JSON.parse(rm.result.value);

  console.log("PROBLEMS", JSON.stringify(problems, null, 2));
  console.log("REPORT", JSON.stringify(report, null, 2));

  cdp.ws.close();
  chrome.kill();
  await sleep(300);
  fs.rmSync(profile, { recursive: true, force: true });
}

main().catch((error) => {
  console.error("FAILED", error);
  process.exitCode = 1;
});
