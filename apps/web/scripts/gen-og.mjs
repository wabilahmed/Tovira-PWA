// Rasterize the OpenGraph card (public/og.svg → public/og.png). Some scrapers
// skip SVG OG images, so we ship a PNG too. Build-time only (sharp is a devDep,
// never shipped to users). Run: `npm run gen:og -w apps/web`.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../public/', import.meta.url));
await sharp(dir + 'og.svg', { density: 200 }).resize(1200, 630).png().toFile(dir + 'og.png');
console.log('wrote public/og.png (1200x630)');
