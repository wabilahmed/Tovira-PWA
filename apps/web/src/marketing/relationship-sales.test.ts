import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WORLDS } from './landing-data.js';

// [P41] Owner, 2026-10-25: Tovira is memory for sales people whose clients stay with them for years. Real
// estate is one use case among several, not the lead. Reads the REAL shipped landing HTML.
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
const d = new DOMParser().parseFromString(html, 'text/html');
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

// [P70 · owner] The landing page was rebuilt from the owner's approved design. The P41/P42 rules are kept below and
// re-pointed to the new page; where the owner's design changed a rule, the test says so.
describe('[P41-1] hero', () => {
  it('the eyebrow is "FOR RELATIONSHIP SALES"', () => {
    expect(text(d.querySelector('#top .tv-up'))).toBe('FOR RELATIONSHIP SALES');
  });
  it('the headline is the P70 one', () => {
    expect(text(d.querySelector('#hero-h'))).toBe('The detail that wins the deal is already in your chats.You just scrolled past it.');
  });
  // "Moments" is internal language.
  it('NEGATIVE: no "moments" anywhere on the landing page', () => {
    expect(html).not.toMatch(/\bmoments\b/i);
  });
});

describe('[P41-2] six relationship-sales industries, property one of six', () => {
  it('six industries, each with what the client said, what Tovira caught, and its source', () => {
    expect(WORLDS.map((w) => w.label)).toEqual(['Property', 'Insurance', 'Wealth', 'B2B accounts', 'Luxury', 'Recruitment']);
    for (const w of WORLDS) for (const k of ['before', 'buried', 'source', 'caught', 'move'] as const) expect(w[k].length, `${w.label}.${k}`).toBeGreaterThan(0);
  });
  // [P70 · owner] was "property is not the lead": the approved design opens on Property. Property is still one of six,
  // and "Real estate" stays gone.
  it('NEGATIVE: "Real estate" is gone, and the industry copy has no em-dash', () => {
    expect(html).not.toMatch(/real estate/i);
    expect(JSON.stringify(WORLDS)).not.toContain('—');
  });
});

describe('[P41-3] FAQ speaks to relationship sales', () => {
  const answer = (q: string) => text([...d.querySelectorAll('details')].find((x) => text(x.querySelector('summary')) === q)?.querySelector('p'));
  // [P70 · owner] the FAQ answers are the approved design's
  it('"Who is it not for?" is framed by clients who stay for years, and keeps the recorded-calls exclusion', () => {
    expect(answer('Who is it not for?')).toBe('Call-centre teams on recorded calls. Tovira is for people whose clients stay with them for years.');
  });
  it('"Is it a CRM?" and "Why not just ask ChatGPT?"', () => {
    expect(answer('Is it a CRM?')).toBe("No. A CRM holds what you type into it. Tovira finds what your clients said that you didn't write down.");
    expect(answer('Why not just ask ChatGPT?')).toBe('ChatGPT answers when you ask. Tovira files every detail under the right client, links it to the message, and brings it up before the meeting, without you asking.');
  });
  it('NEGATIVE: no FAQ answer assumes in-person selling or commission, and none has an em-dash', () => {
    const faq = [...d.querySelectorAll('details')].map(text).join(' ');
    expect(faq).not.toMatch(/sell in person|commission/i);
    expect(faq).not.toContain('—');
  });
});

describe('[P41-4] meta, OG and share descriptions', () => {
  const metas = {
    description: d.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
    'og:description': d.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '',
    'twitter:description': d.querySelector('meta[name="twitter:description"]')?.getAttribute('content') ?? '',
  };
  it.each(Object.entries(metas))('%s is the P70 line', (_name, content) => {
    expect(content).toBe('Tovira analyses your client conversations and voice notes, catches the details a busy rep misses, and puts them in front of you before the meeting that matters.');
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
  it('step 02 names the four languages', () => {
    expect(text(d.querySelector('#how'))).toContain('In English, Arabic, Hindi and Urdu, even mixed.');
  });
  it('NEGATIVE: no "all four in one sentence" claim, and no em-dash anywhere on the page', () => {
    expect(html).not.toMatch(/all four/i);
    expect(html).not.toContain('—');
  });
});

describe('[P42-A3] no claim of real conversations', () => {
  it('NEGATIVE: no claim of "real conversations"', () => {
    expect(html).not.toMatch(/real conversations/i);
  });
});

describe('[P42-A4] the morning line says what Today shows', () => {
  // [P70 · owner] relies on the P69 Today line (what each client cares about), live since dc012f4
  it('step 03: each morning, who to call and what they care about', () => {
    expect(text(d.querySelector('#how'))).toContain('Each morning, who to call and what they care about.');
  });
  it('NEGATIVE: no claim that clients are ranked by who needs you', () => {
    expect(html).not.toMatch(/clients ranked by who needs you/i);
  });
});
