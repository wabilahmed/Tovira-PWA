/**
 * [P89 · owner, Prompt 86] Write the seven game pages (apps/web/game/…/index.html) from src/marketing/game-pages.ts.
 * Run after changing the pages or the game: npx tsx apps/web/scripts/gen-game-pages.ts
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_PAGES, fileOf, gamePageHtml } from '../src/marketing/game-pages.js';

for (const p of GAME_PAGES) {
  const file = fileURLToPath(new URL(`../${fileOf(p)}`, import.meta.url));
  const html = gamePageHtml(p);
  mkdirSync(dirname(file), { recursive: true });
  const same = existsSync(file) && readFileSync(file, 'utf8') === html;
  if (!same) writeFileSync(file, html);
  console.log(`${same ? 'up to date' : 'wrote'} apps/web/${fileOf(p)}`);
}
