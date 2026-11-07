/* Copies the browser builds we actually ship into app/vendor/.
   Run after `pnpm add`: node scripts/vendor.js */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const NM = path.join(ROOT, "node_modules");
const OUT = path.join(ROOT, "app/vendor");

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const size = fs.statSync(to).size;
  console.log(`${path.relative(ROOT, to).padEnd(52)} ${(size / 1024).toFixed(1)} KB`);
}

copy(path.join(NM, "pdf-lib/dist/pdf-lib.esm.min.js"), path.join(OUT, "pdf-lib.min.js"));
copy(path.join(NM, "pdfjs-dist/build/pdf.min.mjs"), path.join(OUT, "pdf.min.mjs"));
copy(path.join(NM, "pdfjs-dist/build/pdf.worker.min.mjs"), path.join(OUT, "pdf.worker.min.mjs"));
copy(path.join(NM, "fflate/esm/browser.js"), path.join(OUT, "fflate.mjs"));

for (const file of ["jbig2.wasm", "openjpeg.wasm", "qcms_bg.wasm"]) {
  copy(path.join(NM, "pdfjs-dist/wasm", file), path.join(OUT, "wasm", file));
}

const fonts = fs.readdirSync(path.join(NM, "pdfjs-dist/standard_fonts"));
let bytes = 0;
for (const file of fonts) {
  const from = path.join(NM, "pdfjs-dist/standard_fonts", file);
  const to = path.join(OUT, "standard_fonts", file);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  bytes += fs.statSync(to).size;
}
console.log(`standard_fonts: ${fonts.length} files, ${(bytes / 1024).toFixed(1)} KB`);
console.log("vendor done");
