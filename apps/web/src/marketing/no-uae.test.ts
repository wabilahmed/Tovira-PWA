import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// [P51 · owner, cleared with the owner's lawyer] Tovira is no longer presented as UAE-only. The landing page (and only the
// landing page: Privacy, Terms, forms and pricing are unchanged) says nothing about the UAE: not in the copy, the meta
// description, the share (OG / Twitter) tags, the FAQ, the request-access section or the footer. No other country is
// named instead. AED prices and the language line stay.
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
const d = new DOMParser().parseFromString(html, 'text/html');
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('[P51] no "UAE" on the landing page', () => {
  it('NEGATIVE: "UAE" appears nowhere: visible copy, meta, OG, Twitter, attributes', () => {
    expect(html).not.toMatch(/\bUAE\b/i);
    expect(html).not.toMatch(/united arab emirates/i);
    for (const m of d.querySelectorAll('meta')) expect(m.getAttribute('content') ?? '', m.outerHTML).not.toMatch(/\bUAE\b|_AE\b|Dubai/i);
  });

  it('the eyebrow is "FOR RELATIONSHIP SALES"', () => {
    expect(text(d.querySelector('.hero .eyebrow'))).toBe('FOR RELATIONSHIP SALES');
  });

  it('the footer names Tovira and the contact address, no location', () => {
    expect(text(d.querySelector('.site-foot p'))).toBe('Tovira · hello@tovira.io');
  });

  it('the meta description keeps the price and drops the country', () => {
    expect(d.querySelector('meta[name="description"]')?.getAttribute('content')).toMatch(/Relationship sales\. AED 299\/month\.$/);
  });

  it('NEGATIVE: no other country is named instead, and AED prices and the language line stay', () => {
    expect(html).not.toMatch(/\b(Saudi|KSA|Qatar|Oman|Bahrain|Kuwait|India|Pakistan|GCC|Middle East)\b/);
    expect(html).toMatch(/AED 299/);
    expect(html).toMatch(/Arabic/);
    expect(html).toMatch(/Hindi/);
    expect(html).toMatch(/Urdu/);
  });
});
