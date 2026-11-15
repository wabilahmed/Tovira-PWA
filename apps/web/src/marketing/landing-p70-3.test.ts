// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WORLDS, ROUNDS, MARQ_A, MARQ_B } from './landing-data.js';

/**
 * [P70-3 · owner] The B2B game chat failed the claim check (the CFO line was caught 2/5: the support worry right after
 * it said "she", so the model merged the two). The owner's fix: the support worry names nobody and comes first, with
 * chatter before the CFO line. Chat 2's "will call you tomorrow" is a real promise, so the game can't call it chatter:
 * it is now "thanks again". The approved design file is updated to match the live page, word for word.
 * Then (owner): the CFO line failed again inside the chat (4/5, then 0/5), so chat 4's third detail is now "Wants a named
 * account manager" (5 runs: 4/5), its subtitle no longer promises a hidden decision-maker, How it works drops "who
 * really decides", and the marquee gains the new detail.
 */
const ref = readFileSync(resolve(process.cwd(), 'plan/tovira-landing-reference.dc.html'), 'utf8');
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');

describe('[P70-3] the owner\'s game edits', () => {
  it('the B2B chat is exactly the owner\'s list, in order', () => {
    expect(ROUNDS[3]!.name).toBe('B2B account');
    expect(ROUNDS[3]!.msgs).toEqual([
      { t: 'Thanks for the call today' },
      { t: 'overall the proposal looks good' },
      { t: "our last vendor's support was painfully slow", sig: 'Worried about slow support', why: 'This is their real objection. Answer it before they raise it and the biggest reason to say no is gone.' },
      { t: 'ok sent you our deck as well' },
      { t: "we'd need a named account manager in the SLA this time", sig: 'Wants a named account manager', why: 'A requirement said once, in passing. Put it in the proposal and you have answered a no before they say it.' },
      { t: 'noted' },
      { t: 'send the revised SLA before the board on the 14th', sig: 'Board meets on the 14th', why: 'A deadline you did not set. Get it in late and the decision slips to next quarter.' },
      { t: 'talk soon' },
    ]);
  });
  it('chat 2 ends "thanks again": no promise is shown as chatter', () => {
    const c2 = ROUNDS[1]!.msgs;
    expect(c2.at(-1)).toEqual({ t: 'thanks again' });
    expect(c2.map((m) => m.t).join(' ')).not.toMatch(/will call|call you/i);
    expect(c2[1]).toEqual({ t: "can we sign after I'm back? I'm in Europe most months for work, so the cover has to work there too", sig: 'Travels to Europe most months', why: "A policy that only covers home won't fit his life. Cover for Europe is what makes your offer the right one." });
  });
  it('chat 4 has no hidden decision-maker: the subtitle, How it works and the marquee say so', () => {
    expect(ROUNDS[3]!.tag).toBe('WhatsApp · the key details hide between the small talk');
    expect(ROUNDS[3]!.msgs.map((m) => m.t)).not.toContain('our MD will sign, but honestly the CFO makes the call');
    expect(html).toContain("What they care about, what they're worried about, every date and promise. In English, Arabic, Hindi and Urdu, even mixed.");
    expect(html).not.toContain('who really decides,');
    expect(MARQ_B).toContain('Wants a named account manager');
    expect(MARQ_A).toContain('The CFO really decides'); // the B2B tab proves it 5/5 alone
  });
  it('the Insurance tab move and chat 5 chatter', () => {
    expect(WORLDS.find((w) => w.label === 'Insurance')!.move).toBe('Bring a policy that covers Europe too.');
    expect(ROUNDS[4]!.msgs[1]).toEqual({ t: 'the traffic was insane haha' });
  });
});

describe('[P70-3] the design file matches the live page', () => {
  it('every game line, detail and reason, and every tab line, is in the design file word for word', () => {
    for (const r of ROUNDS) for (const m of r.msgs) for (const s of [m.t, m.sig, m.why]) if (s) expect(ref, s).toContain(s);
    for (const w of WORLDS) for (const s of [w.before, w.buried, w.after, w.caught, w.move]) expect(ref, s).toContain(s);
    for (const r of ROUNDS) expect(ref, r.tag).toContain(r.tag);
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
