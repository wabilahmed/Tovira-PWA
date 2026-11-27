// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAMES, TRAP_REASONS } from './landing-data.js';

/**
 * [P73 · owner] "Make the hero game a real challenge". Every chat has exactly 5 messages, 1 to 3 useful details each
 * (10 to 11 per industry, not all chats alike); the wrong answers are believable traps (polite, logistics, what every
 * client says, a maybe, small talk), each with its "Why not" reason; every message is in sentence case.
 */
const all = GAMES.flatMap((g) => g.chats.flat());

describe('[P73] the game data', () => {
  it('6 industries in order, 5 chats each, exactly 5 messages per chat', () => {
    expect(GAMES.map((g) => g.label)).toEqual(['Property', 'Insurance', 'Wealth', 'B2B accounts', 'Luxury', 'Recruitment']);
    for (const g of GAMES) {
      expect(g.chats, g.label).toHaveLength(5);
      for (const [i, c] of g.chats.entries()) expect(c, `${g.label} chat ${i + 1}`).toHaveLength(5);
    }
  });
  it('1 to 3 details per chat, 10 to 11 per industry, and the counts are not all the same within an industry', () => {
    for (const g of GAMES) {
      const counts = g.chats.map((c) => c.filter((m) => m.sig).length);
      for (const n of counts) { expect(n, g.label).toBeGreaterThanOrEqual(1); expect(n, g.label).toBeLessThanOrEqual(3); }
      const total = counts.reduce((a, b) => a + b, 0);
      expect(total, g.label).toBeGreaterThanOrEqual(10);
      expect(total, g.label).toBeLessThanOrEqual(11);
      expect(new Set(counts).size, g.label).toBeGreaterThan(1);
    }
  });
  it('every detail and every trap has a reason; every trap reason is one of the five kinds', () => {
    expect(TRAP_REASONS).toEqual([
      'Polite, but it tells you nothing about what they want.',
      'Logistics. Handle it, but it will not change what you offer.',
      'Every client says this. It tells you nothing about this one.',
      'Every maybe sounds like this. There is nothing specific to act on.',
      'Small talk. Nothing to act on.',
    ]);
    for (const m of all) {
      expect(m.why?.length ?? 0, m.t).toBeGreaterThan(20);
      if (!m.sig) expect(TRAP_REASONS, m.t).toContain(m.why);
    }
  });
  it('every message starts with a capital letter (sentence case)', () => {
    for (const m of all) expect(m.t, m.t).toMatch(/^[A-Z]/);
  });
  it('NEGATIVE: no country, Gulf place or person named; no em-dash', () => {
    const text = all.flatMap((m) => [m.t, m.sig ?? '', m.why ?? '']).join('\n');
    expect(text).not.toMatch(/\bUAE\b|emirates|Dubai|Abu Dhabi|Sharjah|\bSZR\b|Sheikh Zayed|\b(India|Pakistan|Saudi|Qatar|Oman|Bahrain|Kuwait|Egypt|Germany|France|Spain|Italy|England|Britain|United Kingdom|United States|America|Canada|China|Japan|Russia)\b/i);
    expect(text).not.toMatch(/\b(UK|USA|U\.S\.|KSA)\b/);
    expect(text).not.toContain('—');
    // People's names: every capitalised word that doesn't start a sentence is on this list (months, days, brands, acronyms).
    const ok = new Set(['I', "I'm", "I'd", "I've", "I'll", 'LSE', 'Europe', 'Microsoft', 'SLA', 'MBA', 'PDF', 'Zoom', 'Teams', 'WhatsApp', 'Tovira', 'Why',
      'January', 'March', 'April', 'May', 'June', 'August', 'September', 'October', 'December', 'Tuesday', 'Thursday', "Thursday's", 'Thursdays', 'Friday', 'Saturdays']);
    const named = [...text.matchAll(/(?<![.!?]\s|^|\n)\b([A-Z][\w']*)/g)].map((m) => m[1]!).filter((w) => !ok.has(w));
    expect(named).toEqual([]);
  });
});

describe('[P73] claim-check changes (owner standing approval)', () => {
  const ts = all.map((m) => m.t);
  it('Property chat 4: the cash detail is tied to what the client needs', () => {
    expect(GAMES[0]!.chats[3]).toContainEqual(expect.objectContaining({ t: "We're paying cash, so we need a seller who can move quickly", sig: 'Paying cash, needs a quick sale' }));
    expect(ts).not.toContain("We're paying cash, we won't need a mortgage");
  });
  it('the traps Tovira stored as a requirement or a worry are swapped for traps of the same kind', () => {
    const swaps: [number, number, string, string, string][] = [
      [0, 4, 'The traffic on the way back was terrible', "Sorry, it's been a long day", 'Small talk. Nothing to act on.'],
      [1, 0, 'We just want good cover at a fair price', "We're keen to get this sorted", 'Every client says this. It tells you nothing about this one.'],
      [1, 4, "Insurance is so confusing, isn't it", 'That all sounds sensible', 'Every client says this. It tells you nothing about this one.'],
      // Wealth chat 4: the first swap, "We're keen to get this right", was stored as a worry 1 run in 5, so swapped again.
      [2, 3, 'We want low risk and good returns', 'Sounds good so far', 'Every client says this. It tells you nothing about this one.'],
      [2, 3, "We're keen to get this right", 'Sounds good so far', 'Every client says this. It tells you nothing about this one.'],
      [2, 1, 'Sounds sensible, let me think about it', 'Let me get back to you on that', 'Every maybe sounds like this. There is nothing specific to act on.'],
      [3, 0, 'We want a solution that just works', 'Sounds promising overall', 'Every client says this. It tells you nothing about this one.'],
      [4, 0, 'We want something special, of course', 'That all sounds lovely', 'Every client says this. It tells you nothing about this one.'],
      [4, 1, 'Something elegant would be nice', 'Everything looked nice, honestly', 'Every client says this. It tells you nothing about this one.'],
      [4, 3, "We want quality, that's the main thing", 'Everything you showed looked great', 'Every client says this. It tells you nothing about this one.'],
      [5, 0, 'I want a good company with a good culture', 'Sounds interesting overall', 'Every client says this. It tells you nothing about this one.'],
      [5, 3, 'I want a role where I can grow', "I'm keen to see what you have", 'Every client says this. It tells you nothing about this one.'],
    ];
    for (const [g, c, old, now, why] of swaps) {
      expect(GAMES[g]!.chats[c], now).toContainEqual({ t: now, why });
      expect(ts, old).not.toContain(old);
    }
  });
});

// [P89 · owner, Prompt 86] The P70 design file is deleted and the game left the landing for its own pages. The Block A
// pins move to /game: the game column is still 640px at most (the page's main), the pick grid is the same auto-fit grid,
// the card keeps its tighter padding, and the game code keeps the reasons and the warning (game.ts).
describe('[P73→P89] the game page', () => {
  it('the /game page: the auto-fit industry grid, no HOW IT WORKS, the tighter card padding', () => {
    const html = readFileSync(resolve(process.cwd(), 'apps/web/game/index.html'), 'utf8');
    expect(html).toContain('<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px">');
    expect(html).not.toContain('HOW IT WORKS');
    expect(html).not.toContain('HOW TO PLAY');
    expect(html).toContain('.g-card{background:#FFFFFF;border:1px solid var(--line);border-radius:20px;padding:clamp(14px,2.4vw,20px)');
    expect(html).toContain('.g-main{max-width:640px;');
  });
  it('the game code: the reasons, "Why it counts" / "Why not", and the warning', () => {
    const game = readFileSync(resolve(process.cwd(), 'apps/web/src/marketing/game.ts'), 'utf8');
    expect(TRAP_REASONS[0]).toBe('Polite, but it tells you nothing about what they want.');
    expect(game).toContain("whyLabel: m.sig ? 'Why it counts: ' : 'Why not: '");
    expect(game).toContain("export const WARN_LINE = 'Pick a wrong one and you fail this chat.';");
  });
});
