/* Small CDP client used by the fixture generator and the app smoke test. */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const CHROME = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners) listener(message);
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

  on(listener) {
    this.listeners.add(listener);
  }

  off(listener) {
    this.listeners.delete(listener);
  }
}

/**
 * Launch headless Chrome, open a page target, return a session helper.
 */
async function launch({ port = 9333, viewport = { width: 1440, height: 900 } } = {}) {
  const profile = path.resolve(`.chrome-profile-${port}`);
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
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let version = null;
  for (let i = 0; i < 100 && !version; i += 1) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch (error) {
      await sleep(150);
    }
  }
  if (!version) throw new Error("Chrome did not start");

  const cdp = await CDP.connect(version.webSocketDebuggerUrl);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

  const session = (method, params) => cdp.send(method, params, sessionId);
  await session("Page.enable");
  await session("Runtime.enable");
  await session("Log.enable");
  await session("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const problems = [];
  cdp.on((message) => {
    if (message.method === "Runtime.exceptionThrown") {
      problems.push("exception: " + (message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text));
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      problems.push("console.error: " + message.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
      problems.push("log: " + message.params.entry.text);
    }
  });

  async function evaluate(expression) {
    const result = await session("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async function goto(url) {
    const loaded = new Promise((resolve) => {
      const listener = (message) => {
        if (message.method !== "Page.loadEventFired") return;
        cdp.off(listener);
        resolve();
      };
      cdp.on(listener);
      setTimeout(resolve, 10000);
    });
    await session("Page.navigate", { url });
    await loaded;
  }

  async function waitFor(expression, { timeout = 15000, interval = 120 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return true;
      await sleep(interval);
    }
    throw new Error("Timed out waiting for: " + expression);
  }

  async function screenshot(file) {
    const { data } = await session("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
  }

  async function close() {
    cdp.ws.close();
    chrome.kill();
    await sleep(250);
    fs.rmSync(profile, { recursive: true, force: true });
  }

  return { cdp, session, evaluate, goto, waitFor, screenshot, close, problems };
}

module.exports = { CDP, launch, sleep, CHROME };
