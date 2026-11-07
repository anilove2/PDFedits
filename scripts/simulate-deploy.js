/* Builds .deploy-preview with exactly the files Vercel would upload, then prints a summary.
   Run the suite against it with BASE=http://127.0.0.1:4322. */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, ".deploy-preview");

const ALLOW = [
  "index.html",
  "404.html",
  "robots.txt",
  "sitemap.xml",
  "sw.js",
  "site.webmanifest",
  "vercel.json",
  "app",
  "assets",
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let files = 0;
let bytes = 0;

function copy(rel) {
  const from = path.join(ROOT, rel);
  const to = path.join(OUT, rel);
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const child of fs.readdirSync(from)) copy(path.join(rel, child));
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  files += 1;
  bytes += stat.size;
}

for (const entry of ALLOW) {
  if (!fs.existsSync(path.join(ROOT, entry))) {
    console.error("missing from allowlist:", entry);
    process.exit(1);
  }
  copy(entry);
}

console.log(`deploy preview: ${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log("serve with: SERVE_ROOT=.deploy-preview PORT=4322 node scripts/serve.js");
