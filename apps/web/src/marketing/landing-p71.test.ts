// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAMES } from './landing-data.js';

/**
 * [P71 · owner] The game's data: 6 industries, 5 chats each, 12 details per industry, uneven per chat (so a visitor
 * can't count on how many a chat hides). Every detail carries its "Why it counts" reason. No country and no person is
 * named (P51, P70).
 */
const all = GAMES.flatMap((g) => g.chats.flat());

describe('[P71] the game data', () => {
  it('6 industries in order, 5 chats each', () => {
    expect(GAMES.map((g) => g.label)).toEqual(['Property', 'Insurance', 'Wealth', 'B2B accounts', 'Luxury', 'Recruitment']);
    for (const g of GAMES) expect(g.chats, g.label).toHaveLength(5);
  });
  it('every industry totals 12 details, 1 to 4 per chat, and the counts are not all the same', () => {
    for (const g of GAMES) {
      const counts = g.chats.map((c) => c.filter((m) => m.sig).length);
      expect(counts.reduce((a, b) => a + b, 0), g.label).toBe(12);
      for (const n of counts) { expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThanOrEqual(4); }
      expect(new Set(counts).size, g.label).toBeGreaterThan(1);
    }
    expect(all.filter((m) => m.sig)).toHaveLength(72);
  });
  it('every detail has a reason, and chatter has neither', () => {
    for (const m of all) {
      if (m.sig) expect(m.why?.length ?? 0, m.sig).toBeGreaterThan(20);
      else expect([m.sig, m.why]).toEqual([undefined, undefined]);
    }
  });
  it('NEGATIVE: no country, Gulf place or person named; no em-dash', () => {
    const text = all.flatMap((m) => [m.t, m.sig ?? '', m.why ?? '']).join('\n');
    expect(text).not.toMatch(/\bUAE\b|emirates|Dubai|Abu Dhabi|Sharjah|\bSZR\b|Sheikh Zayed|\b(India|Pakistan|Saudi|Qatar|Oman|Bahrain|Kuwait|Egypt|Germany|France|Spain|Italy|England|Britain|United Kingdom|United States|America|Canada|China|Japan|Russia)\b/i);
    expect(text).not.toMatch(/\b(UK|USA|U\.S\.|KSA)\b/);
    expect(text).not.toContain('—');
    // People's names: every capitalised word that doesn't start a sentence is on this list (months, brands, acronyms).
    const ok = new Set(['I', "I'm", "I'd", "I've", 'LSE', 'Europe', 'Microsoft', 'SLA', 'MBA', 'Tovira', 'January', 'March', 'April', 'May', 'June', 'August', 'September', 'October', 'December', 'Why']);
    const named = [...text.matchAll(/(?<![.!?]\s|^|\n)\b([A-Z][\w']*)/g)].map((m) => m[1]!).filter((w) => !ok.has(w));
    expect(named).toEqual([]);
  });
});

describe('[P71] the hero shows the new game', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
  const d = new DOMParser().parseFromString(html, 'text/html');
  it('headed "Would you have caught it?" with "A 2-MINUTE TEST", and the first render is the pick screen', () => {
    const game = d.querySelector('#top #game')!;
    expect(game.querySelector('h2')!.textContent).toBe('Would you have caught it?');
    expect(game.textContent).toContain('A 2-MINUTE TEST');
    expect(game.textContent).not.toContain('5 CHATS · 12 DETAILS');
    expect(game.textContent).not.toContain('Each chat is harder than the last.');
    expect(game.querySelectorAll('[data-game] button[data-act="start"]')).toHaveLength(6);
  });
});
