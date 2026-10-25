import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// [P41] Owner, 2026-10-25: Tovira is memory for sales people whose clients stay with them for years. Real
// estate is one use case among several, not the lead. Reads the REAL shipped landing HTML.
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
const d = new DOMParser().parseFromString(html, 'text/html');
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('[P41-1] hero', () => {
  it('the eyebrow is "FOR RELATIONSHIP SALES · UAE"', () => {
    expect(text(d.querySelector('.hero .eyebrow'))).toBe('FOR RELATIONSHIP SALES · UAE');
  });
  it('the headline is kept', () => {
    expect(text(d.querySelector('#hero-h'))).toBe('Forty clients.Ten thousand details.One memory.');
  });
  it('the example card counts conversations', () => {
    expect(text(d.querySelector('.hero .device__meta'))).toBe('on file since MAR 2026 · 34 conversations');
  });
  // "Moments" is internal language. ("the moment you need them" in the kept hero copy is plain English.)
  it('NEGATIVE: no "moments" anywhere on the landing page', () => {
    expect(html).not.toMatch(/\bmoments\b/i);
  });
});

const CARDS = [
  { label: 'INSURANCE AND BROKERAGE',
    body: 'Renewal dates are the business. Tovira tracks every one, along with the objection they raised last year and the claim that made them cautious.',
    quote: '“renewal is in June, last year the excess was too high”', stamp: 'WHATSAPP · 20 JAN 2026' },
  { label: 'WEALTH AND PRIVATE BANKING',
    body: 'Relationships measured in years, not quarters. The graduation, the new business, the football club. Those details are the relationship, and Tovira never loses one.',
    quote: '“daughter graduates from LSE in July, he\'s flying over”', stamp: 'WHATSAPP · 03 MAR 2026' },
  { label: 'B2B AND KEY ACCOUNTS',
    body: 'Ten people on every account, a buying cycle that runs for months, and a champion who might move on. Tovira remembers who signs off, what they pushed back on, and what you promised.',
    quote: '“procurement wants the revised SLA before the board meets on the 14th”', stamp: 'WHATSAPP · 08 APR 2026' },
  { label: 'LUXURY AND CLIENT ADVISORS',
    body: 'Sizes, tastes, anniversaries and the piece they asked you to hold. The details that make a client feel known, kept for every one of them.',
    quote: '“her anniversary is in May, she loved the emerald set”', stamp: 'WHATSAPP · 17 FEB 2026' },
  { label: 'RECRUITMENT AND EXECUTIVE SEARCH',
    body: 'Candidates and clients you will place again in three years. What they want next, what they won\'t move for, and when to call.',
    quote: '“not moving before my bonus in March, but call me after”', stamp: 'WHATSAPP · 12 JAN 2026' },
  { label: 'PROPERTY',
    body: 'Every buyer\'s budget, community, school run, and the spouse with the real veto. Tovira holds each preference and remembers which listing belongs to whom.',
    quote: '“somewhere in Arabian Ranches, budget 3.2M, near the school”', stamp: 'WHATSAPP · 11 FEB 2026' },
];

describe('[P41-2] use cases: relationship sales, property one of six', () => {
  const section = d.querySelector('section[aria-labelledby="use-h"]')!;
  const cards = [...section.querySelectorAll('.usecases > .usecase')];

  it('keeps the title and adds the subtitle under it', () => {
    expect(text(section.querySelector('#use-h'))).toBe('Built for people whose deals are relationships.');
    const sub = section.querySelector('#use-h + p');
    expect(text(sub)).toBe('If your clients stay with you for years, Tovira was made for them.');
  });

  it('six cards, in the owner\'s order, each label + body + one dated WhatsApp quote', () => {
    expect(cards).toHaveLength(6);
    cards.forEach((card, i) => {
      const want = CARDS[i]!;
      expect(text(card.querySelector('.usecase__label')).toUpperCase()).toBe(want.label);
      expect(text(card.querySelector('.usecase__label + p'))).toBe(want.body);
      const receipts = card.querySelectorAll('.tov-receipt');
      expect(receipts).toHaveLength(1);
      expect(text(receipts[0]!.querySelector('.tov-receipt__q'))).toBe(want.quote);
      expect(text(receipts[0]!.querySelector('.tov-stamp'))).toBe(want.stamp);
    });
  });

  it('NEGATIVE: property is not the lead, "Real estate" is gone, and the new copy has no em-dash', () => {
    expect(text(cards[0]?.querySelector('.usecase__label')).toUpperCase()).not.toBe('PROPERTY');
    expect(text(section)).not.toMatch(/real estate/i);
    expect(section.textContent).not.toContain('—');
  });
});

describe('[P41-3] FAQ speaks to relationship sales', () => {
  const answer = (q: string) => text([...d.querySelectorAll('details.faq__item')].find((x) => text(x.querySelector('summary')) === q)?.querySelector('p'));

  it('"Who is it not for?" is framed by clients who stay for years, and keeps the recorded-calls exclusion', () => {
    expect(answer('Who is it not for?')).toBe('It is for relationship sales: people whose clients stay with them for years, where one client is worth more than a year of the price. If you sell on recorded video calls where every word is already transcribed, your conversations are already captured. Tovira is built for the ones that are not.');
  });

  it('"Is it a CRM?" and "Why not just use ChatGPT?" are kept as they are', () => {
    expect(answer('Is it a CRM?')).toBe('No. A CRM is a form you fill in for your manager. Tovira is a memory that fills itself in for you. If you have a CRM, keep it.');
    expect(answer('Why not just use ChatGPT?')).toBe('You can paste a thread into a chat window and get a decent answer. You cannot paste forty clients into it every morning, and it will never tell you on a Tuesday that a client has gone quiet.');
  });

  it('NEGATIVE: no FAQ answer assumes in-person selling or commission, and none has an em-dash', () => {
    const faq = text(d.querySelector('.faq'));
    expect(faq).not.toMatch(/sell in person|commission/i);
    expect(faq).not.toContain('—');
  });
});

describe('[P41-4] meta, OG and share descriptions name long-term client relationships', () => {
  const metas = {
    description: d.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
    'og:description': d.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '',
    'twitter:description': d.querySelector('meta[name="twitter:description"]')?.getAttribute('content') ?? '',
  };
  it.each(Object.entries(metas))('%s says the clients stay for years', (_name, content) => {
    expect(content).toContain('sales people whose clients stay with them for years');
  });
  it('NEGATIVE: no share text says field sales, property or real estate, and none has an em-dash', () => {
    for (const content of Object.values(metas)) {
      expect(content).not.toMatch(/field sales|property|real estate/i);
      expect(content).not.toContain('—');
    }
  });
});

// [P42-A] Owner approvals of the P41 claim check: every line states only what the product has been shown to do.
describe('[P42-A1] the language line claims only what the eval covers', () => {
  const step2 = text(d.querySelector('.step[data-step="1"] p:not(.step__n)'));
  it('step 02 names the four languages and English mixed with any of them', () => {
    expect(step2).toBe('Promises, people, dates, concerns, personal details, pulled out and filed against the right client, even when that client is saved under one name in your phone and goes by another in the chat. Arabic, English, Hindi and Urdu, and English mixed with any of them in the same sentence.');
  });
  it('NEGATIVE: no "all four in one sentence" claim, and no em-dash anywhere on the page', () => {
    expect(html).not.toMatch(/all four/i);
    expect(html).not.toContain('—');
  });
});

describe('[P42-A2] the language FAQ claims only what the eval covers', () => {
  it('"Does it work in Arabic?" names Arabic, Hindi or Urdu mixed with English', () => {
    const item = [...d.querySelectorAll('details.faq__item')].find((x) => text(x.querySelector('summary')) === 'Does it work in Arabic?');
    expect(text(item?.querySelector('p'))).toBe('Yes, including Arabic mixed with English in the same sentence, and Hindi or Urdu mixed with English too. That is what it was built for.');
  });
  it('NEGATIVE: the FAQ no longer implies all four languages in one sentence', () => {
    expect(text(d.querySelector('.faq'))).not.toMatch(/English, Hindi, and Urdu in the same sentence/i);
  });
});
