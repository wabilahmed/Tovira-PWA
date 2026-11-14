import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * [P69 · owner] Tovira's promise is "helps you close", not "a memory": it analyses your client conversations, picks
 * out what each client cares about, and puts it in front of you when it matters. Memory (promises, dates) is the
 * supporting line. Every example is something the product shows (What they care about, on the client page, the
 * brief, the reminder and Today). Reads the REAL shipped landing HTML.
 */
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
const d = new DOMParser().parseFromString(html, 'text/html');
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
// [P70 · owner] The landing page was rebuilt from the owner's approved design. The P69 promise stays ("helps you close":
// it analyses your conversations and catches what you missed), now worded by the new page; its copy is pinned in
// landing-p70.test.ts. The P69 rules below still hold on the rebuilt page.
const DESC = 'Tovira analyses your client conversations and voice notes, catches the details a busy rep misses, and puts them in front of you before the meeting that matters.';

describe('[P69] the hero', () => {
  it('eyebrow, headline and subhead (the P70 wording of the P69 promise)', () => {
    expect(text(d.querySelector('#top .tv-up'))).toBe('FOR RELATIONSHIP SALES');
    expect(text(d.querySelector('#hero-h'))).toBe('The detail that wins the deal is already in your chats.You just scrolled past it.');
    expect(text(d.querySelector('#hero-h + p'))).toBe(DESC);
  });
  it('every example names what the client said and what Tovira caught, linked to the message', () => {
    expect(text(d.querySelector('[role="tabpanel"]'))).toContain('WHAT THE CLIENT SAID');
    expect(text(d.querySelector('[role="tabpanel"]'))).toContain('Linked to the message it came from.');
  });
});

describe('[P69] what Tovira does, in order (now the three "How it works" steps)', () => {
  it('give it the conversation, it analyses every line, it speaks up at the right time', () => {
    expect([...d.querySelectorAll('#how h3')].map(text)).toEqual(['Give it the conversation', 'Tovira analyses every line', 'It speaks up at the right time']);
    expect(text(d.querySelector('#how'))).toContain('Each morning, who to call and what they care about. And it never forgets a promise, yours or theirs.');
  });
});

describe('[P69] the six industries: what the client said, and what Tovira caught', () => {
  it('six tabs, each with a caught line', () => {
    expect([...d.querySelectorAll('[role="tab"]')].map(text)).toEqual(['Property', 'Insurance', 'Wealth', 'B2B accounts', 'Luxury', 'Recruitment']);
  });
  // [P70 · owner] "Your move" now suggests the rep's next step ("Lead with the sea-view units."), labelled as the
  // rep's decision ("You decide. Tovira just makes sure you saw it."). What Tovira caught still never advises.
  it('NEGATIVE: no caught line advises what to sell or show, and no invented results', () => {
    expect(text(d.querySelector('[data-world="caught"]'))).not.toMatch(/\b(show (them|her|him)|offer|pitch|sell|recommend|suggest)\b/i);
    expect(html).toContain('You decide. Tovira just makes sure you saw it.');
    expect(html).not.toMatch(/\d+\s?% (more|faster|higher)|close \d+/i);
  });
});

describe('[P69] meta and share text', () => {
  it.each(['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]'])('%s', (sel) => {
    expect(d.querySelector(sel)?.getAttribute('content')).toBe(DESC);
  });
});

describe('[P69] memory is the supporting line, never the headline', () => {
  it('NEGATIVE: no title, headline or share text leads with memory', () => {
    const leads = [d.title, text(d.querySelector('h1')), ...['og:title', 'twitter:title'].map((p) => d.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute('content') ?? '')];
    for (const l of leads) expect(l).not.toMatch(/memory|remember/i);
    expect(html).not.toMatch(/memory for sales people/i);
  });
  it('NEGATIVE: "analyses", never "reads your chats" (the wording rule)', () => {
    expect(html).not.toMatch(/\breads (it|your|the)\b|\breading your chats\b/i);
  });
});
