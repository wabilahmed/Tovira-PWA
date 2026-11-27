import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAMES } from './landing-data.js';

// [P41] Owner, 2026-10-25: Tovira is memory for sales people whose clients stay with them for years. Real
// estate is one use case among several, not the lead. Reads the REAL shipped landing HTML.
// [P89 · owner, Prompt 86] The page is now the owner's Marker page (plan/brand.md: write for both "too long" and "too
// many" sellers). The P41/P42 rules are kept and re-pointed; where the owner's words changed a rule, the test says so:
// "Who is it not for?" is back with the owner's answer (P76 had removed it); "Is it a CRM?" and "Why not just ask
// ChatGPT?" are gone (their point is now "Different on purpose", which names no competitor); there is no language line.
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
const d = new DOMParser().parseFromString(html, 'text/html');
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('[P41-1] hero', () => {
  it('NEGATIVE: no eyebrow above the headline', () => {
    expect(html).not.toMatch(/FOR RELATIONSHIP SALES/i);
    expect(d.querySelector('h1')!.previousElementSibling).toBeNull();
  });
  it('the headline is the owner\'s Marker one', () => {
    expect(text(d.querySelector('h1'))).toBe('Walk into every meeting knowing what matters to them.');
  });
  it('NEGATIVE: no "moments" anywhere on the landing page', () => {
    expect(html).not.toMatch(/\bmoments\b/i);
  });
});

describe('[P41-2] property is one industry of six', () => {
  it('the game\'s six industries (on /game), property one of them', () => {
    expect(GAMES.map((g) => g.label)).toEqual(['Property', 'Insurance', 'Wealth', 'B2B accounts', 'Luxury', 'Recruitment']);
  });
  it('NEGATIVE: "Real estate" is gone, and the page has no em-dash', () => {
    expect(html).not.toMatch(/real estate/i);
    expect(html).not.toContain('—');
  });
});

describe('[P41-3→P89] the FAQ', () => {
  const answer = (q: string) => text([...d.querySelectorAll('details')].find((x) => text(x.querySelector('summary')) === q)?.querySelector('p'));
  it('"Who is it not for?" says it in the owner\'s words: people who sell through chat, few clients for years or many at once', () => {
    expect(answer('Who is it not for?')).toBe('Call-centre teams on recorded calls. Tovira is for people who sell through chat: a few clients for years, or hundreds at once.');
  });
  it('NEGATIVE: "Is it a CRM?" and "Why not just ask ChatGPT?" are gone, and no competitor is named anywhere', () => {
    expect(answer('Is it a CRM?')).toBe('');
    expect(answer('Why not just ask ChatGPT?')).toBe('');
    expect(html).not.toMatch(/ChatGPT|OpenAI|Gemini|Copilot|Salesforce|HubSpot|Zoho|Pipedrive|Otter|Fireflies|Gong/i);
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
  it.each(Object.entries(metas))('%s is the owner\'s hero line', (_name, content) => {
    expect(content).toBe('Tovira reads your client chats and catches the details that close deals.');
  });
  it('NEGATIVE: no share text says field sales, property or real estate, and none has an em-dash', () => {
    for (const content of Object.values(metas)) {
      expect(content).not.toMatch(/field sales|property|real estate/i);
      expect(content).not.toContain('—');
    }
  });
});

// [P42-A] Owner approvals of the P41 claim check: every line states only what the product has been shown to do.
describe('[P42-A1→P89] no language claim', () => {
  it('NEGATIVE: no language list and no "all four in one sentence" claim (the owner\'s page carries no language line)', () => {
    expect(html).not.toMatch(/all four/i);
    expect(html).not.toMatch(/\b(Arabic|Hindi|Urdu)\b/);
  });
});
describe('[P42-A3] no claim of real conversations', () => {
  it('NEGATIVE: no claim of "real conversations"', () => {
    expect(html).not.toMatch(/real conversations/i);
  });
});
describe('[P42-A4] no ranking claim', () => {
  it('NEGATIVE: no claim that clients are ranked by who needs you', () => {
    expect(html).not.toMatch(/clients ranked by who needs you/i);
  });
});
