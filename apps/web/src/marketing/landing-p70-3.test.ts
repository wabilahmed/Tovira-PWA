// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WORLDS, GAMES, MARQ_A, MARQ_B } from './landing-data.js';

/**
 * [P70-3 · owner] The B2B game chat failed the claim check (the CFO line was caught 2/5: the support worry right after
 * it said "she", so the model merged the two). The owner's fix: the support worry names nobody and comes first, with
 * chatter before the CFO line. Chat 2's "will call you tomorrow" is a real promise, so the game can't call it chatter:
 * it is now "thanks again". The approved design file is updated to match the live page, word for word.
 * Then (owner): the CFO line failed again inside the chat (4/5, then 0/5), so chat 4's third detail is now "Wants a named
 * account manager" (5 runs: 4/5), its subtitle no longer promises a hidden decision-maker, How it works drops "who
 * really decides", and the marquee gains the new detail.
 * [P71 · owner] The 5-chat game is replaced by the pick-your-industry game (30 chats). The old chat-by-chat pins move
 * to its B2B, Insurance and Luxury chats where the lines carried over; the design-file match now covers all 30 chats.
 */
const chat = (label: string, n: number) => GAMES.find((g) => g.label === label)!.chats[n]!;
const ref = readFileSync(resolve(process.cwd(), 'plan/tovira-landing-reference.dc.html'), 'utf8');
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');

describe('[P70-3] the owner\'s game edits, as carried into the P71 game', () => {
  it('the B2B lines carry over word for word (B2B chats 2 and 3)', () => {
    const c = chat('B2B accounts', 2);
    expect(c).toContainEqual({ t: "our last vendor's support was painfully slow", sig: 'Worried about slow support', why: 'This is their real objection. Answer it before they raise it and the biggest reason to say no is gone.' });
    expect(c).toContainEqual({ t: "we'd need a named account manager in the SLA this time", sig: 'Wants a named account manager', why: 'A requirement said once, in passing. Put it in the proposal and you have answered a no before they say it.' });
    expect(chat('B2B accounts', 1)).toContainEqual({ t: 'send the revised SLA before the board on the 14th', sig: 'Board meets on the 14th', why: 'A deadline you did not set. Get it in late and the decision slips to next quarter.' });
  });
  it('no promise is shown as chatter, and the Europe line carries over (Insurance chat 2)', () => {
    for (const g of GAMES) for (const c of g.chats) expect(c.filter((m) => !m.sig).map((m) => m.t).join(' ')).not.toMatch(/will call|call you/i);
    expect(chat('Insurance', 1)[1]).toEqual({ t: "can we sign after I'm back? I'm in Europe most months for work, so the cover has to work there too", sig: 'Travels to Europe most months', why: "A policy that only covers home won't fit his life. Cover for Europe is what makes your offer the right one." });
  });
  it('no hidden decision-maker in the game: How it works and the marquee say so', () => {
    for (const g of GAMES) for (const c of g.chats) expect(c.map((m) => m.t)).not.toContain('our MD will sign, but honestly the CFO makes the call');
    expect(html).toContain("What they care about, what they're worried about, every date and promise. In English, Arabic, Hindi and Urdu, even mixed.");
    expect(html).not.toContain('who really decides,');
    expect(MARQ_B).toContain('Wants a named account manager');
    expect(MARQ_A).toContain('The CFO really decides'); // the B2B tab proves it 5/5 alone
  });
  it('the Insurance tab move and the traffic chatter', () => {
    expect(WORLDS.find((w) => w.label === 'Insurance')!.move).toBe('Bring a policy that covers Europe too.');
    expect(chat('Luxury', 3)[1]).toEqual({ t: 'the traffic was insane haha' });
  });
});

describe('[P70-3] the design file matches the live page', () => {
  it('every game chat (all 30), detail and reason, and every tab line, is in the design file word for word', () => {
    // [P71] all 30 chats, in order: the design's games array, parsed, is exactly the page's data
    const i = ref.indexOf('const games = [');
    const games = new Function(ref.slice(i, ref.indexOf('\n    ];', i) + 7) + '; return games;')() as Array<{ label: string; chats: string[][][] }>;
    expect(games.map((g) => ({ label: g.label, chats: g.chats.map((c) => c.map(([t, sig, why]) => (sig ? { t, sig, why } : { t }))) }))).toEqual(GAMES);
    for (const w of WORLDS) for (const s of [w.before, w.buried, w.after, w.caught, w.move]) expect(ref, s).toContain(s);
    expect(ref).toContain("What they care about, what they're worried about, every date and promise.");
    expect(ref).toContain("'Wears gold, never silver', 'Wants a named account manager']");
  });
  it('NEGATIVE: neither file names a Gulf place or a country', () => {
    const bad = /\bUAE\b|united arab emirates|emirates|Dubai|Abu Dhabi|Sharjah|\bSZR\b|Sheikh Zayed|\b(India|Pakistan|Saudi|Qatar|Oman|Bahrain|Kuwait|Egypt|Germany|France|Spain|Italy|England|Britain|United Kingdom|United States|America|Canada|China|Japan|Russia)\b/i;
    for (const [name, src] of [['design', ref], ['page', html]] as const) {
      const m = src.match(bad) ?? src.match(/\b(UK|USA|U\.S\.|KSA)\b/);
      expect(m?.[0] ?? null, name).toBeNull();
    }
    expect(html).toMatch(/\bAED\b/); // AED stays
  });
});
