/* global URL, console, document */
// [P89 · owner, Prompt 86] The share images (1200x630 PNG), rendered from the landing hero in headless Chromium with the
// real Geist font: the logo on the white ground, the headline with its key words marked in yellow. og.png is the landing
// ("what matters" marked); og-game*.png are the game pages (their H1, "wins the deal" marked). Build-time only.
// Run: `npm run gen:og -w apps/web` (after `npx tsx apps/web/scripts/gen-game-pages.ts` if a game page title changed).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pub = fileURLToPath(new URL('../public/', import.meta.url));
const font = readFileSync(fileURLToPath(new URL('../src/marketing/fonts/geist-latin-wght-normal.woff2', import.meta.url))).toString('base64');
const DISC = '<svg width="64" height="64" viewBox="0 0 30 30"><circle cx="15" cy="15" r="15" fill="#0A0A0A"/><rect x="6" y="7" width="18" height="6" rx="1.5" fill="#FFE45C"/><rect x="12" y="15" width="6" height="9" rx="1.5" fill="#FFFFFF"/></svg>';

const GAME = [['og-game.png', 'Can you spot the detail that <mark>wins the deal</mark>?']]
  .concat([['property', 'Property'], ['insurance', 'Insurance'], ['wealth', 'Wealth'], ['b2b', 'B2B'], ['luxury', 'Luxury'], ['recruitment', 'Recruitment']]
    .map(([slug, name]) => [`og-game-${slug}.png`, `${name} sales test: can you spot the detail that <mark>wins the deal</mark>?`]));
const IMAGES = [['og.png', 'Walk into every meeting knowing <mark>what matters</mark> to them.', 92], ...GAME.map(([f, h]) => [f, h, 76])];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const [file, headline, size] of IMAGES) {
  await page.setContent(`<!doctype html><style>
@font-face{font-family:Geist;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}
html,body{margin:0;width:1200px;height:630px;background:#FAFAFA;color:#0A0A0A;font-family:Geist,sans-serif}
.w{box-sizing:border-box;width:1200px;height:630px;padding:72px 88px;display:flex;flex-direction:column;justify-content:space-between}
.logo{display:flex;align-items:center;gap:18px;font-weight:600;font-size:44px;letter-spacing:-.03em}
h1{margin:0;font-weight:600;font-size:${size}px;line-height:1.04;letter-spacing:-.045em;max-width:1000px;text-wrap:balance}
mark{background:linear-gradient(transparent 58%,#FFE45C 58%);color:inherit;padding:0 8px}
</style><div class="w"><div class="logo">${DISC}Tovira</div><h1>${headline}</h1></div>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: pub + file, type: 'png' });
  console.log(`wrote public/${file} (1200x630)`);
}
await browser.close();
