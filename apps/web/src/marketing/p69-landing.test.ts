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
const DESC = 'Tovira analyses your client conversations and picks out what each client cares about, so you can close.';

describe('[P69] the hero', () => {
  it('eyebrow, headline and subhead', () => {
    expect(text(d.querySelector('.hero .eyebrow'))).toBe('FOR RELATIONSHIP SALES');
    expect(text(d.querySelector('#hero-h'))).toBe('Your clients already told you how to win them.');
    expect(text(d.querySelector('.hero .lede'))).toBe('Tovira analyses your conversations and voice notes, picks out what each client cares about, and reminds you before every meeting. It never forgets a promise, either.');
  });
  it('the hero card shows what the client cares about, each with its message', () => {
    const screen = d.querySelector('.hero .device__screen')!;
    expect(text(screen.querySelector('.device__label'))).toBe('What they care about');
    expect([...screen.querySelectorAll('.tov-receipt__label')].map(text)).toEqual(['Loves the beach', 'Budget around 3.2M']);
    expect([...screen.querySelectorAll('.tov-receipt__q')].map(text)).toEqual(['“honestly I love the beach”', '“budget around 3.2M, 2 bed ideally”']);
  });
});

describe('[P69] the three pillars, in order', () => {
  const pillars = [...d.querySelectorAll('.pillars > .pillar')];
  it('spots what they care about, shows it when it matters, keeps every promise', () => {
    expect(pillars.map((p) => [text(p.querySelector('h3')), text(p.querySelector('p'))])).toEqual([
      ['Spots what they care about', 'She mentioned once that she loves the beach. Tovira picks it out: “Loves the beach.” Every detail links to the message it came from.'],
      ['Shows it when it matters', 'A brief before every meeting, and each morning, the clients to call and what they care about.'],
      ['Keeps every promise', "Every date and commitment, yours and theirs, on your list before it's due."],
    ]);
  });
  it('they come straight after the hero', () => {
    const headings = [...d.querySelectorAll('h1, h2')].map(text);
    expect(headings.slice(0, 2)).toEqual(['Your clients already told you how to win them.', 'What Tovira does']);
  });
});

const CARDS: Array<[string, string, string]> = [
  ['INSURANCE AND BROKERAGE', 'Said once, months ago. Tovira shows Travels to Europe often before the renewal.', '“I\'m in Europe most summers”'],
  ['WEALTH AND PRIVATE BANKING', 'Said in passing. Tovira shows Daughter at LSE from September.', '“my daughter starts at LSE in September”'],
  ['B2B AND KEY ACCOUNTS', 'Buried in a long thread. Tovira shows Board meeting 14th, on their page and in the brief before it.', '“the board meets on the 14th”'],
  ['LUXURY AND CLIENT ADVISORS', 'Two details in one message. Tovira shows Anniversary in May · loved the emerald set.', '“our anniversary is in May, she loved the emerald set”'],
  ['RECRUITMENT AND EXECUTIVE SEARCH', 'One line in a long chat. Tovira shows Wants hybrid.', '“With the school run I\'d want hybrid, three days in the office max”' /* [P69-16 · owner] was the pregnancy line: health data, never on the landing */],
  ['PROPERTY', 'Her first message. Tovira shows Loves the beach · budget ~3.2M.', '“I love the beach, budget around 3.2M”'],
];

describe('[P69] the six use-case cards: what the client said, and what Tovira surfaces', () => {
  const cards = [...d.querySelectorAll('section[aria-labelledby="use-h"] .usecases > .usecase')];
  it('label, body, quote, in order', () => {
    expect(cards.map((c) => [text(c.querySelector('.usecase__label')).toUpperCase(), text(c.querySelector('.usecase__label + p')), text(c.querySelector('.tov-receipt__q'))])).toEqual(CARDS);
  });
  it('NEGATIVE: no card advises what to sell or show, and no invented results', () => {
    for (const c of cards) expect(text(c)).not.toMatch(/\b(show (them|her|him)|offer|pitch|sell|recommend|suggest)\b/i);
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
