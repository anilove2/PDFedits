/* Generates a 100-page PDF for the large-document checks. */
const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let i = 1; i <= 100; i += 1) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText("PDFEdits", { x: 48, y: 790, size: 11, font: bold, color: rgb(0.14, 0.39, 0.92) });
    page.drawText(`Page ${i}`, { x: 48, y: 700, size: 40, font: bold, color: rgb(0.06, 0.09, 0.16) });
    page.drawRectangle({ x: 48, y: 560, width: 500, height: 100, color: rgb(0.93, 0.95, 0.99) });
    for (let line = 0; line < 6; line += 1) {
      page.drawText("The quick brown fox jumps over the lazy dog.", {
        x: 48,
        y: 520 - line * 18,
        size: 10,
        font,
        color: rgb(0.35, 0.4, 0.5),
      });
    }
    page.drawText(`${i} / 100`, { x: 500, y: 48, size: 9, font, color: rgb(0.55, 0.6, 0.7) });
  }

  const bytes = await doc.save();
  const file = path.resolve("preview/fixtures/large.pdf");
  fs.writeFileSync(file, bytes);
  console.log("large.pdf", (bytes.length / 1024).toFixed(0), "KB, 100 pages");
})();
