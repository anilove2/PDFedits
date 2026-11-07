/* PDFEdits service worker — offline shell for a local-first app. */
const CACHE = "pdfedits-v1";

const SHELL = [
  "/",
  "/index.html",
  "/app",
  "/app/",
  "/app/index.html",
  "/app/app.css",
  "/app/app.js",
  "/app/boot.js",
  "/app/engine.js",
  "/app/viewer.js",
  "/assets/css/fonts.css",
  "/assets/css/tokens.css",
  "/assets/css/styles.css",
  "/assets/js/boot.js",
  "/assets/js/main.js",
  "/assets/favicon.svg",
  "/site.webmanifest",
  "/assets/fonts/plus-jakarta-sans-latin.woff2",
  "/assets/fonts/plus-jakarta-sans-latin-ext.woff2",
  "/app/vendor/pdf.min.mjs",
  "/app/vendor/pdf.worker.min.mjs",
  "/app/vendor/pdf-lib.min.js",
  "/app/vendor/fflate.mjs",
  "/app/vendor/wasm/jbig2.wasm",
  "/app/vendor/wasm/openjpeg.wasm",
  "/app/vendor/wasm/qcms_bg.wasm",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network first, cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          put(request, response.clone());
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = url.pathname.startsWith("/app") ? "/app/index.html" : "/index.html";
          return (await caches.match(fallback)) || (await caches.match("/index.html"));
        })
    );
    return;
  }

  // Assets: cache first, refresh quietly in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) put(request, response.clone());
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});

function put(request, response) {
  caches.open(CACHE).then((cache) => cache.put(request, response)).catch(() => undefined);
}
