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

describe('[P73] the design file and the page', () => {
  const ref = readFileSync(resolve(process.cwd(), 'plan/tovira-landing-reference.dc.html'), 'utf8');
  it('the design file carries Block A (the 500px box, HOW IT WORKS in 5 steps, the auto-fit industry grid)', () => {
    expect(ref).toContain('<div id="game" class="tv-up" style="flex: 1 1 400px; min-width: 0; max-width: 500px; display: flex; flex-direction: column; gap: 12px; animation-delay: .3s; scroll-margin-top: 84px">');
    expect(ref).toContain('>HOW IT WORKS</div>');
    expect(ref).not.toContain('HOW TO PLAY');
    expect(ref).toContain('<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px">');
    expect(ref).toContain("const POL = 'Polite, but it tells you nothing about what they want.';");
    expect(ref).toContain("whyLabel: isSig ? 'Why it counts: ' : 'Why not: '");
    expect(ref).toContain('Tap every useful detail. At least one, maybe more.');
    expect(ref).toContain('{{m.whyLabel}}');
  });
  it('the page: the game column is 500px at most, the card padding is tighter', () => {
    const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
    expect(html).toContain('<div id="game" class="tv-up" style="flex: 1 1 400px; min-width: 0; max-width: 500px; display: flex; flex-direction: column; gap: 12px; animation-delay: .3s; scroll-margin-top: 84px">');
    expect(html).toContain('border-radius: 22px; padding: clamp(14px, 2.4vw, 20px); display: flex; flex-direction: column; gap: 14px; box-shadow: 0 30px 80px rgba(0,0,0,0.45)" data-game>');
    expect(html).toContain('font-size: clamp(22px, 2.2vw, 26px); line-height: 1.1">Would you have caught it?</h2>');
  });
});
