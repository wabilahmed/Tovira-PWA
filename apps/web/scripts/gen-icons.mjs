/* global URL, console, Buffer */
// [P89 · owner, Prompt 86] The favicon and app icons, from the Marker logo disc alone (plan/brand.md "Logo"): a black
// disc holding a T, a white stem under a level yellow bar. Drawn as SVG and rasterised with sharp. The maskable and
// Apple icons are full-bleed ink (the launcher's own mask makes the disc), the T kept inside the safe zone.
// Build-time only (never shipped to users). Run: `npm run gen:icons -w apps/web`.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pub = fileURLToPath(new URL('../public/', import.meta.url));
const INK = '#0A0A0A';
const HL = '#FFE45C';

/** The T on the 30-unit grid (bar above, stem below), scaled by k about the centre. */
const tee = (k) => `<g transform="translate(15 15) scale(${k}) translate(-15 -15)"><rect x="6" y="7" width="18" height="6" rx="1.5" fill="${HL}"/><rect x="12" y="15" width="6" height="9" rx="1.5" fill="#FFFFFF"/></g>`;
export const DISC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><circle cx="15" cy="15" r="15" fill="${INK}"/>${tee(1)}</svg>`;
const fullBleed = (k) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><rect width="30" height="30" fill="${INK}"/>${tee(k)}</svg>`;

const TARGETS = [
  { file: 'favicon-32.png', size: 32, svg: DISC_SVG },
  { file: 'icons/icon-192.png', size: 192, svg: DISC_SVG },
  { file: 'icons/icon-512.png', size: 512, svg: DISC_SVG },
  { file: 'icons/icon-maskable-512.png', size: 512, svg: fullBleed(0.8) },
  { file: 'apple-touch-icon.png', size: 180, svg: fullBleed(0.9) },
];

writeFileSync(pub + 'favicon.svg', DISC_SVG + '\n');
console.log('wrote public/favicon.svg');
for (const t of TARGETS) {
  await sharp(Buffer.from(t.svg), { density: Math.ceil((t.size / 30) * 72 * 2) }).resize(t.size, t.size).png({ compressionLevel: 9 }).toFile(pub + t.file);
  console.log(`wrote public/${t.file} (${t.size}x${t.size})`);
}
