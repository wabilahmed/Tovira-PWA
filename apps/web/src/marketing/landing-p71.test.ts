// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAMES, MARQ_B } from './landing-data.js';

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

describe('[P71] claim-check rewordings (owner)', () => {
  it('Property chat 4: "we\'d pay cash" was caught 3/5, so it is now a firm statement', () => {
    const c = GAMES[0]!.chats[3]!;
    expect(c).toContainEqual({ t: "we're paying cash, we won't need a mortgage", sig: 'Paying cash', why: 'A cash buyer can move fast. That changes which sellers you call first and how hard you can negotiate.' });
    expect(c.map((m) => m.t)).not.toContain("we'd pay cash, no mortgage");
  });
  // [P71 · owner] Tovira stores a budget only when it is tied to what the client wants found (logged for the next cert).
  it('Insurance chat 3 and Luxury chat 3: the budget is tied to what they are looking for', () => {
    const ins = GAMES[1]!.chats[2]!;
    expect(ins).toContainEqual(expect.objectContaining({ t: "I'm looking for a policy around 800 a month", sig: 'Budget about 800 a month' }));
    expect(ins.map((m) => m.t)).not.toContain('budget is around 800 a month');
    const lux = GAMES[4]!.chats[2]!;
    expect(lux).toContainEqual(expect.objectContaining({ t: "I'm looking for something around 20k", sig: 'Budget about 20k' }));
    expect(lux.map((m) => m.t)).not.toContain('my budget is around 20k');
  });
  it('Wealth chat 5: the match line was stored as a hobby 3/5, so its chatter is now "haha true"', () => {
    const c = GAMES[2]!.chats[4]!.map((m) => m.t);
    expect(c[1]).toBe('haha true');
    expect(c).not.toContain('the match last night was something');
  });
  it('B2B chat 5: the hire line was never stored as a condition 0/5, so it is now a stated price worry', () => {
    const c = GAMES[3]!.chats[4]!;
    expect(c).toContainEqual({ t: 'honestly the price worries us, it has to save us at least one hire', sig: 'Price worry: must save one hire', why: 'They told you how to justify the price. Show the hire it saves.' });
    expect(c.map((m) => m.t)).not.toContain('if it saves us one hire, it pays for itself');
    expect(c.map((m) => m.sig)).not.toContain('Measures value as one hire saved');
  });
  it('B2B chat 3: "overall looks good" (an opinion that could be stored) is now "ok great"', () => {
    const c = GAMES[3]!.chats[2]!.map((m) => m.t);
    expect(c[1]).toBe('ok great');
    expect(c).not.toContain('overall looks good');
  });
  it('B2B chat 3: the team size, a plain company fact, was stored 0/5, so it is now something they need', () => {
    const c = GAMES[3]!.chats[2]!;
    expect(c).toContainEqual({ t: 'we need it to work for 40 people now, and 60 next year', sig: 'Needs it for 40 now, 60 next year', why: 'Price for 60, not 40. Growth is your next upsell.' });
    expect(c.map((m) => m.t)).not.toContain("we're 40 people now, maybe 60 next year");
  });
  it('Luxury chat 2: "she" was never said to be anyone, stored 0/5, so it is now the wife; the marquee says the same', () => {
    const c = GAMES[4]!.chats[1]!;
    expect(c).toContainEqual(expect.objectContaining({ t: 'my wife only wears gold, never silver', sig: 'Wife wears gold, never silver' }));
    expect(c.map((m) => m.t)).not.toContain('she only wears gold, never silver');
    expect(MARQ_B).toContain('Wife wears gold, never silver');
    expect(MARQ_B).not.toContain('Wears gold, never silver');
    const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
    expect(html).toContain('>Wife wears gold, never silver</span>');
    expect(html).not.toMatch(/>(She w|W)ears gold, never silver</);
    const ref = readFileSync(resolve(process.cwd(), 'plan/tovira-landing-reference.dc.html'), 'utf8');
    expect(ref).toContain("'Wife wears gold, never silver', 'Wants a named account manager']");
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
