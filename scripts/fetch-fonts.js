const fs = require('fs');
const path = require('path');

const OUT = path.resolve('assets/fonts');
const CSS = path.resolve('assets/css/fonts.css');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.dirname(CSS), { recursive: true });

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

(async () => {
  const url =
    'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300..800&display=swap';
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('css ' + res.status);
  const css = await res.text();

  const blocks = [...css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)];
  console.log('blocks', blocks.length);

  const faces = [];
  for (const [, subset, block] of blocks) {
    if (!['latin', 'latin-ext'].includes(subset)) continue;
    const weight = /font-weight:\s*([^;]+);/.exec(block)[1].trim();
    const range = /unicode-range:\s*([^;]+);/.exec(block)[1].trim();
    const src = /url\((https:[^)]+\.woff2)\)/.exec(block)[1];
    const file = `plus-jakarta-sans-${subset}.woff2`;
    const binary = Buffer.from(await (await fetch(src, { headers: { 'User-Agent': UA } })).arrayBuffer());
    fs.writeFileSync(path.join(OUT, file), binary);
    faces.push({ weight, range, file, bytes: binary.length });
    console.log(subset, weight, file, binary.length);
  }

  const cssOut = faces
    .map(
      (f) => `@font-face {
  font-family: 'Plus Jakarta Sans';
  font-style: normal;
  font-weight: ${f.weight};
  font-display: swap;
  src: url('../fonts/${f.file}') format('woff2');
  unicode-range: ${f.range};
}`
    )
    .join('\n\n');

  fs.writeFileSync(CSS, cssOut + '\n', 'utf8');
  console.log('wrote', CSS);
})();
