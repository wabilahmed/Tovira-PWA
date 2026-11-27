// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAMES } from './landing-data.js';

/**
 * [P71 · owner] The game's data: 6 industries, 5 chats each, 12 details per industry, uneven per chat (so a visitor
 * can't count on how many a chat hides). Every detail carries its "Why it counts" reason. No country and no person is
 * named (P51, P70).
 * [P73 · owner] The counts and the chatter rule move to landing-p73.test.ts: 5 messages per chat, 1 to 3 details, 10 to
 * 11 per industry, and every wrong answer is a trap with its own "Why not" reason. The P71 rewordings below carry over in
 * sentence case; the chatter lines they pinned ("haha true", "ok great") are gone with all the old chatter.
 */
const all = GAMES.flatMap((g) => g.chats.flat());

describe('[P71] the game data', () => {
  it('6 industries in order, 5 chats each', () => {
    expect(GAMES.map((g) => g.label)).toEqual(['Property', 'Insurance', 'Wealth', 'B2B accounts', 'Luxury', 'Recruitment']);
    for (const g of GAMES) expect(g.chats, g.label).toHaveLength(5);
  });
  it('[P73] the counts are not all the same within an industry, and every detail has a reason', () => {
    for (const g of GAMES) expect(new Set(g.chats.map((c) => c.filter((m) => m.sig).length)).size, g.label).toBeGreaterThan(1);
    for (const m of all) if (m.sig) expect(m.why?.length ?? 0, m.sig).toBeGreaterThan(20);
  });
  it('NEGATIVE: no country, Gulf place or person named; no em-dash', () => {
    const text = all.flatMap((m) => [m.t, m.sig ?? '', m.why ?? '']).join('\n');
    expect(text).not.toMatch(/\bUAE\b|emirates|Dubai|Abu Dhabi|Sharjah|\bSZR\b|Sheikh Zayed|\b(India|Pakistan|Saudi|Qatar|Oman|Bahrain|Kuwait|Egypt|Germany|France|Spain|Italy|England|Britain|United Kingdom|United States|America|Canada|China|Japan|Russia)\b/i);
    expect(text).not.toMatch(/\b(UK|USA|U\.S\.|KSA)\b/);
    expect(text).not.toContain('—');
    // People's names: every capitalised word that doesn't start a sentence is on this list (months, brands, acronyms).
    // [P73] the traps add days of the week and the tools clients name (PDF, Zoom, Teams, WhatsApp); still no person
    const ok = new Set(['I', "I'm", "I'd", "I've", "I'll", 'LSE', 'Europe', 'Microsoft', 'SLA', 'MBA', 'PDF', 'Zoom', 'Teams', 'WhatsApp', 'Tovira', 'January', 'March', 'April', 'May', 'June', 'August', 'September', 'October', 'December', 'Tuesday', 'Thursday', "Thursday's", 'Thursdays', 'Friday', 'Saturdays', 'Why']);
    const named = [...text.matchAll(/(?<![.!?]\s|^|\n)\b([A-Z][\w']*)/g)].map((m) => m[1]!).filter((w) => !ok.has(w));
    expect(named).toEqual([]);
  });
});

describe('[P71] claim-check rewordings (owner)', () => {
  // [P73 · owner] the P73 claim check caught "We're paying cash, we won't need a mortgage" only 3/5 in the new chat, so
  // (standing approval) it is tied to what the client needs; the new line is pinned in landing-p73.test.ts.
  it('Property chat 4: "we\'d pay cash" was caught 3/5, so it is now a firm statement', () => {
    const c = GAMES[0]!.chats[3]!;
    expect(c).toContainEqual({ t: "We're paying cash, so we need a seller who can move quickly", sig: 'Paying cash, needs a quick sale', why: 'A cash buyer can move fast. That changes which sellers you call first and how hard you can negotiate.' });
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
  it('Wealth chat 5: the match line (stored as a hobby 3/5) stays out', () => {
    const c = GAMES[2]!.chats[4]!.map((m) => m.t.toLowerCase());
    expect(c).not.toContain('the match last night was something');
  });
  it('B2B chat 5: the hire line was never stored as a condition 0/5, so it is now a stated price worry', () => {
    const c = GAMES[3]!.chats[4]!;
    expect(c).toContainEqual({ t: 'Honestly the price worries us, it has to save us at least one hire', sig: 'Price worry: must save one hire', why: 'They told you how to justify the price. Show the hire it saves.' });
    expect(c.map((m) => m.t)).not.toContain('if it saves us one hire, it pays for itself');
    expect(c.map((m) => m.sig)).not.toContain('Measures value as one hire saved');
  });
  it('B2B chat 3: "overall looks good" (an opinion that could be stored) stays out', () => {
    const c = GAMES[3]!.chats[2]!.map((m) => m.t.toLowerCase());
    expect(c).not.toContain('overall looks good');
  });
  it('B2B chat 3: the team size, a plain company fact, was stored 0/5, so it is now something they need', () => {
    const c = GAMES[3]!.chats[2]!;
    expect(c).toContainEqual({ t: 'We need it to work for 40 people now, and 60 next year', sig: 'Needs it for 40 now, 60 next year', why: 'Price for 60, not 40. Growth is your next upsell.' });
    expect(c.map((m) => m.t)).not.toContain("we're 40 people now, maybe 60 next year");
  });
  // [P89 · owner, Prompt 86] the marquee and the P70 design file are gone; the game chat keeps the wife, and no page shows
  // the old unnamed "she" line
  it('Luxury chat 2: "she" was never said to be anyone, stored 0/5, so it is now the wife', () => {
    const c = GAMES[4]!.chats[1]!;
    expect(c).toContainEqual(expect.objectContaining({ t: 'My wife only wears gold, never silver', sig: 'Wife wears gold, never silver' }));
    expect(c.map((m) => m.t)).not.toContain('she only wears gold, never silver');
    const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
    expect(html).not.toMatch(/>(She w|W)ears gold, never silver</);
  });
});

// [P89 · owner, Prompt 86] The game moved off the landing to its own pages. The landing keeps only the slim "Would you
// have caught it?" banner to /game; the pick screen (six industries) is /game's first render.
describe('[P71→P89] the game lives on /game; the landing has its banner', () => {
  it('the landing: no game card, one banner to /game headed "Would you have caught it?" with "A 2-MINUTE TEST"', () => {
    const d = new DOMParser().parseFromString(readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8'), 'text/html');
    expect(d.querySelector('[data-game]')).toBeNull();
    const banner = d.querySelectorAll('a[data-banner]');
    expect(banner).toHaveLength(1);
    expect(banner[0]!.getAttribute('href')).toBe('/game');
    expect(banner[0]!.textContent).toContain('Would you have caught it?');
    expect(banner[0]!.textContent).toContain('A 2-MINUTE TEST');
  });
  it('/game renders the pick screen first: six links to the industry pages', () => {
    const d = new DOMParser().parseFromString(readFileSync(resolve(process.cwd(), 'apps/web/game/index.html'), 'utf8'), 'text/html');
    expect(d.querySelectorAll('[data-game] a.tv-pick')).toHaveLength(6);
    expect(d.querySelector('[data-game]')!.textContent).not.toContain('5 CHATS · 12 DETAILS');
  });
});
