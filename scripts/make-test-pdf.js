// Generates a large lecture-script-like PDF for performance testing.
// usage: node scripts/make-test-pdf.js out.pdf [pages]
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const fs = require('fs');

(async () => {
  const out = process.argv[2] || 'big.pdf';
  const n = Number(process.argv[3] || 600);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const words = 'semiconductor band gap electron hole mobility doping junction diode transistor MOSFET gate drain source channel silicon carbide gallium nitride power switching losses breakdown voltage'.split(' ');
  for (let i = 0; i < n; i++) {
    const landscape = i % 50 === 49;
    const page = doc.addPage(landscape ? [841.89, 595.28] : [595.28, 841.89]);
    if (i === 7) page.setRotation(degrees(90));
    const { width, height } = page.getSize();
    page.drawText(`Chapter ${Math.floor(i / 20) + 1} - Lecture page ${i + 1}`, { x: 50, y: height - 70, size: 20, font: bold, color: rgb(0.1, 0.2, 0.45) });
    let y = height - 110;
    let k = i;
    while (y > 80) {
      let line = '';
      for (let w = 0; w < 12; w++) line += words[(k++ * 7 + w * 3) % words.length] + ' ';
      if (y < height - 400 && y > height - 420) line = 'Die Bandluecke von Silizium betraegt 1,12 eV bei Raumtemperatur.';
      page.drawText(line, { x: 50, y, size: 11, font, color: rgb(0.15, 0.15, 0.15) });
      y -= 16;
    }
    // Some vector graphics (curves) to make rendering non-trivial.
    for (let c = 0; c < 6; c++) {
      page.drawSvgPath(`M 0 0 C 40 ${-60 - c * 10} 120 ${40 + c * 8} 200 ${-20 * c}`, { x: 300, y: 200 + c * 12, borderColor: rgb(0.2, 0.4 + c * 0.08, 0.7), borderWidth: 1.2 });
    }
    page.drawRectangle({ x: 50, y: 60, width: width - 100, height: 0.8, color: rgb(0.7, 0.7, 0.7) });
  }
  fs.writeFileSync(out, await doc.save());
  console.log(`wrote ${out} (${n} pages, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
})();
