import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// [P41] Owner, 2026-10-25: Tovira is memory for sales people whose clients stay with them for years. Real
// estate is one use case among several, not the lead. Reads the REAL shipped landing HTML.
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
const d = new DOMParser().parseFromString(html, 'text/html');
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('[P41-1] hero', () => {
  // [P51 · owner] was "FOR RELATIONSHIP SALES · UAE": Tovira is no longer presented as UAE-only (no-uae.test.ts)
  it('the eyebrow is "FOR RELATIONSHIP SALES"', () => {
    expect(text(d.querySelector('.hero .eyebrow'))).toBe('FOR RELATIONSHIP SALES');
  });
  // [P69 · owner] the headline is now "Your clients already told you how to win them." (pinned in p69-landing.test.ts)
  it('the headline is the P69 one', () => {
    expect(text(d.querySelector('#hero-h'))).toBe('Your clients already told you how to win them.');
  });
  it('the example card counts conversations', () => {
    expect(text(d.querySelector('.hero .device__meta'))).toBe('on file since MAR 2026 · 34 conversations');
  });
  // "Moments" is internal language. ("the moment you need them" in the kept hero copy is plain English.)
  it('NEGATIVE: no "moments" anywhere on the landing page', () => {
    expect(html).not.toMatch(/\bmoments\b/i);
  });
});

const CARDS = [ // [P69 · owner] each body is what the client said and what Tovira surfaces (pinned in p69-landing.test.ts)
  { label: 'INSURANCE AND BROKERAGE',
    body: 'Said once, months ago. Tovira shows Travels to Europe often before the renewal.',
    quote: '“I\'m in Europe most summers”', stamp: 'WHATSAPP · 20 JAN 2026' },
  { label: 'WEALTH AND PRIVATE BANKING',
    body: 'Said in passing. Tovira shows Daughter at LSE from September.',
    quote: '“my daughter starts at LSE in September”', stamp: 'WHATSAPP · 03 MAR 2026' },
  { label: 'B2B AND KEY ACCOUNTS',
    body: 'Buried in a long thread. Tovira shows Board meeting 14th, on their page and in the brief before it.',
    quote: '“the board meets on the 14th”', stamp: 'WHATSAPP · 08 APR 2026' },
  { label: 'LUXURY AND CLIENT ADVISORS',
    body: 'Two details in one message. Tovira shows Anniversary in May · loved the emerald set.',
    quote: '“our anniversary is in May, she loved the emerald set”', stamp: 'WHATSAPP · 17 FEB 2026' },
  { label: 'RECRUITMENT AND EXECUTIVE SEARCH',
    body: 'One line in a long chat. Tovira shows Wants hybrid.',
    quote: '“after the baby I\'d want hybrid”', stamp: 'WHATSAPP · 12 JAN 2026' },
  { label: 'PROPERTY',
    body: 'Her first message. Tovira shows Loves the beach · budget ~3.2M.',
    quote: '“I love the beach, budget around 3.2M”', stamp: 'WHATSAPP · 11 FEB 2026' },
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
  // [P69 · owner] the share text is now the owner's line: what each client cares about, so you can close
  it.each(Object.entries(metas))('%s is the P69 line', (_name, content) => {
    expect(content).toBe('Tovira analyses your client conversations and picks out what each client cares about, so you can close.');
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
    // [P69 · owner] step 02 leads with what each client cares about; the language line is unchanged
    expect(step2).toBe('What each client cares about, and their promises, people, dates and concerns, picked out and filed against the right client, even when that client is saved under one name in your phone and goes by another in the chat. Arabic, English, Hindi and Urdu, and English mixed with any of them in the same sentence.');
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

describe('[P42-A3] the verification line says realistic, not real, conversations', () => {
  it('the standard names realistic sales conversations', () => {
    expect(text(d.querySelector('.standard'))).toBe('The standard it had to pass: zero invented commitments. Zero guessed dates. Verified across repeated runs on realistic sales conversations, in four languages.');
  });
  it('NEGATIVE: no claim of "real conversations"', () => {
    expect(html).not.toMatch(/real conversations/i);
  });
});

describe('[P42-A4] the ranking line says what Today actually ranks', () => {
  it('step 03 says follow-ups in order and the clients who may be slipping, with the reason', () => {
    expect(text(d.querySelector('.step[data-step="2"] p:not(.step__n)'))).toBe("A brief before the meeting. The day's follow-ups in order, and the clients who may be slipping, with the reason. A statement on Monday morning. A quiet word when a client goes quiet. Tovira speaks rarely. When it speaks, act.");
  });
  it('NEGATIVE: no claim that clients are ranked by who needs you', () => {
    expect(html).not.toMatch(/clients ranked by who needs you/i);
  });
});
