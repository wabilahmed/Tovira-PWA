/* global URL, console, document, Buffer */
// [P31] Generate the favicon + PWA icons from the brand mark: the wordmark's terracotta "T" (Fraunces 600,
// --brass #d14821) on the paper background (--surface-base #f4f1ea). The glyph is drawn with the REAL
// Fraunces font in headless Chromium (Playwright), centred on its measured ink box, rendered at 1024px and
// downscaled with sharp. Build-time only (never shipped to users). Run: `npm run gen:icons -w apps/web`.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pub = fileURLToPath(new URL('../public/', import.meta.url));
const fontFile = fileURLToPath(new URL('../../../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2', import.meta.url));
const font = readFileSync(fontFile).toString('base64');

const PAPER = '#f4f1ea';
const TERRACOTTA = '#d14821';
const RENDER = 1024;

// glyphShare = the T's ink height as a share of the icon. 'maskable' keeps it well inside the 80% safe zone.
const TARGETS = [
  { file: 'icons/icon-192.png', size: 192, glyphShare: 0.62 },
  { file: 'icons/icon-512.png', size: 512, glyphShare: 0.62 },
  { file: 'icons/icon-maskable-512.png', size: 512, glyphShare: 0.5 },
  { file: 'apple-touch-icon.png', size: 180, glyphShare: 0.6 },
  { file: 'favicon-32.png', size: 32, glyphShare: 0.78 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<style>@font-face { font-family: 'Fraunces'; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 100 900; }</style><canvas id="c" width="${RENDER}" height="${RENDER}"></canvas>`);

for (const t of TARGETS) {
  const dataUrl = await page.evaluate(async ({ RENDER, PAPER, TERRACOTTA, share }) => {
    await document.fonts.load(`600 100px Fraunces`);
    const c = document.getElementById('c');
    const ctx = c.getContext('2d');
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, RENDER, RENDER);
    // Size the font so the T's ink height is `share` of the canvas, then centre its ink box exactly.
    ctx.font = `600 100px Fraunces`;
    const probe = ctx.measureText('T');
    const inkH100 = probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent;
    const px = (RENDER * share * 100) / inkH100;
    ctx.font = `600 ${px}px Fraunces`;
    const m = ctx.measureText('T');
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const x = (RENDER - w) / 2 + m.actualBoundingBoxLeft;
    const y = (RENDER - h) / 2 + m.actualBoundingBoxAscent;
    ctx.fillStyle = TERRACOTTA;
    ctx.fillText('T', x, y);
    return c.toDataURL('image/png');
  }, { RENDER, PAPER, TERRACOTTA, share: t.glyphShare });
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  await sharp(png).resize(t.size, t.size, { kernel: 'lanczos3' }).flatten({ background: PAPER }).png({ compressionLevel: 9 }).toFile(pub + t.file);
  console.log(`wrote public/${t.file} (${t.size}x${t.size})`);
}
await browser.close();
