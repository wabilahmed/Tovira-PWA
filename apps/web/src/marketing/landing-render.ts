/**
 * [P70 · owner] The landing page's repeated and stateful pieces, rendered from landing-data.ts. index.html carries
 * their first render between <!--gen:NAME--> markers (so the page is complete with no JavaScript, and nothing shifts
 * when the scripts start); landing-render.test.ts fails if a marker's content drifts from this.
 * Regenerate: npx tsx apps/web/scripts/gen-landing.ts
 */
import { MARQ_A, MARQ_B, WALL_A, WALL_B, WALL_C, marq, stars, wall, type WallLine } from './landing-data.js';
import { cardHtml, esc, initialState } from './game.js';
import { panelHtml, tabsHtml } from './worlds.js';

const marqHtml = (items: string[]): string => marq(items).map((q) => `<span style="padding: 0 28px; color: ${q.color}">${esc(q.t)}</span>`).join('');
const wallHtml = (lines: WallLine[]): string => wall(lines)
  .map((m) => `<div${m.cls ? ` class="${m.cls}"` : ''} style="background: #221D1A; border-radius: 14px; padding: 10px 12px; font-size: 13px; line-height: 1.4; color: ${m.color}">${esc(m.text)}</div>`).join('');

export const FRAGMENTS: Record<string, () => string> = {
  stars: () => stars().map((s) => `<div class="tv-star" style="${s}"></div>`).join(''),
  marqA: () => marqHtml(MARQ_A),
  marqB: () => marqHtml(MARQ_B),
  wallA: () => wallHtml(WALL_A),
  wallB: () => wallHtml(WALL_B),
  wallC: () => wallHtml(WALL_C),
  tabs: () => tabsHtml(0),
  panel: () => panelHtml(0),
  game: () => cardHtml(initialState()),
};

/** Replace each <!--gen:NAME-->…<!--/gen:NAME--> block's content with its fresh render. */
export function fillFragments(html: string): string {
  return html.replace(/<!--gen:(\w+)-->[\s\S]*?<!--\/gen:\1-->/g, (_all, name: string) => {
    const f = FRAGMENTS[name];
    if (!f) throw new Error(`unknown landing fragment: ${name}`);
    return `<!--gen:${name}-->${f()}<!--/gen:${name}-->`;
  });
}

/** Each marker's content as it is in the file (for the drift test). */
export function fragmentsIn(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<!--gen:(\w+)-->([\s\S]*?)<!--\/gen:\1-->/g)) out[m[1]!] = m[2]!;
  return out;
}
