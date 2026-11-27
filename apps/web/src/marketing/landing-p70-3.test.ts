// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { GAMES, TRAP_REASONS } from './landing-data.js';

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
 * [P73 · owner] Every message is in sentence case, so the carried-over lines start with a capital; the traffic line in
 * Luxury chat 4 is now the trap "The traffic was insane on the way back" (small talk, with its reason). The design's
 * data now starts with the five trap reasons, so the parse reads from there.
 * [P89 · owner, Prompt 86] The P70 design file is deleted (plan/tovira-landing-marker.html replaces it) and the landing
 * has no tabs or marquee any more. The game stays exactly as it is, on /game: the pins on its chats stay, the design-file
 * match becomes a content hash of the game (taken on main before P89, unchanged), and the no-places rule now reads the
 * Marker reference and the page.
 */
const chat = (label: string, n: number) => GAMES.find((g) => g.label === label)!.chats[n]!;
const ref = readFileSync(resolve(process.cwd(), 'plan/tovira-landing-marker.html'), 'utf8');
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');

describe('[P70-3] the owner\'s game edits, as carried into the P71 game', () => {
  it('the B2B lines carry over word for word (B2B chats 2 and 3)', () => {
    const c = chat('B2B accounts', 2);
    expect(c).toContainEqual({ t: "Our last vendor's support was painfully slow", sig: 'Worried about slow support', why: 'This is their real objection. Answer it before they raise it and the biggest reason to say no is gone.' });
    expect(c).toContainEqual({ t: "We'd need a named account manager in the SLA this time", sig: 'Wants a named account manager', why: 'A requirement said once, in passing. Put it in the proposal and you have answered a no before they say it.' });
    expect(chat('B2B accounts', 1)).toContainEqual({ t: 'Send the revised SLA before the board on the 14th', sig: 'Board meets on the 14th', why: 'A deadline you did not set. Get it in late and the decision slips to next quarter.' });
  });
  it('no promise is shown as chatter, and the Europe line carries over (Insurance chat 2)', () => {
    for (const g of GAMES) for (const c of g.chats) expect(c.filter((m) => !m.sig).map((m) => m.t).join(' ')).not.toMatch(/will call|call you/i);
    expect(chat('Insurance', 1)[0]).toEqual({ t: "Can we sign after I'm back? I'm in Europe most months for work, so the cover has to work there too", sig: 'Travels to Europe most months', why: "A policy that only covers home won't fit his life. Cover for Europe is what makes your offer the right one." });
  });
  it('no hidden decision-maker in the game: How it works and the marquee say so', () => {
    for (const g of GAMES) for (const c of g.chats) expect(c.map((m) => m.t)).not.toContain('our MD will sign, but honestly the CFO makes the call');
    // [P89 · owner] the How it works line and the marquee are gone with the P70 page; the page still names no hidden
    // decision-maker (P89's copy guard: no decision-maker named only by role)
    expect(html).not.toContain('who really decides');
    expect(html).not.toMatch(/\bCFO\b/);
  });
  it('the traffic chatter (the Insurance tab is gone with the P70 page)', () => {
    expect(chat('Luxury', 3)[0]).toEqual({ t: 'The traffic was insane on the way back', why: 'Small talk. Nothing to act on.' });
  });
});

describe('[P70-3→P89] the game is frozen; the Marker reference and the page name no place', () => {
  it('the game (all 30 chats, every detail and reason, the five trap reasons) is exactly as it was before P89', () => {
    expect(createHash('sha256').update(JSON.stringify({ GAMES, TRAP_REASONS })).digest('hex')).toBe('7063de1015e49c4e696644379a3eb382c56d1d9c6f00740ccf0572ecf067824b');
    expect(GAMES.map((g) => g.chats.length)).toEqual([5, 5, 5, 5, 5, 5]);
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
