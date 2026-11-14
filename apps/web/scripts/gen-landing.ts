/**
 * [P70] Fill the landing page's generated blocks (stars, marquee, chat wall, tabs, first panel, first game state)
 * from src/marketing/landing-data.ts. Run after changing the data: npx tsx apps/web/scripts/gen-landing.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fillFragments } from '../src/marketing/landing-render.js';

const file = fileURLToPath(new URL('../index.html', import.meta.url));
const before = readFileSync(file, 'utf8');
const after = fillFragments(before);
if (after !== before) writeFileSync(file, after);
console.log(after === before ? 'landing fragments already up to date' : 'landing fragments regenerated');
