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
    expect(text(d.querySelector('#top .tv-up'))).toBe('FOR RELATIONSHIP SALES'); // [P70 · owner] the rebuilt hero
  });

  // [P70 · owner] the footer is now the company line; the contact address sits under the closing CTA. Still no location.
  it('the footer names Tovira and the company, no location; the contact address is on the page', () => {
    expect(text(d.querySelector('footer > div > div'))).toBe('Tovira · Prospera Technologies FZ-LLC');
    expect(text(d.querySelector('footer'))).not.toMatch(/UAE|Dubai|Emirates/);
    expect(d.querySelector('a[href="mailto:hello@tovira.io"]')).not.toBeNull();
  });

  // [P69 · owner] the description is now the owner's one line, with no price (the price stays on the page); still no country
  it('the meta description drops the country', () => {
    expect(d.querySelector('meta[name="description"]')?.getAttribute('content')).not.toMatch(/UAE|Emirates|Dubai/);
  });

  // [P70 · owner] the tabs and the game render more copy in the browser than the HTML ships: none of it names the UAE
  it('NEGATIVE: the industry tabs and the game name no country or UAE road either', () => {
    const data = readFileSync(resolve(process.cwd(), 'apps/web/src/marketing/landing-data.ts'), 'utf8');
    expect(data.slice(data.indexOf('export const'))).not.toMatch(/\bUAE\b|united arab emirates|Dubai|Abu Dhabi|\bSZR\b|Sheikh Zayed/i);
  });

  it('NEGATIVE: no other country is named instead, and AED prices and the language line stay', () => {
    expect(html).not.toMatch(/\b(Saudi|KSA|Qatar|Oman|Bahrain|Kuwait|India|Pakistan|GCC|Middle East)\b/);
    expect(html).toMatch(/AED 299/);
    expect(html).toMatch(/Arabic/);
    expect(html).toMatch(/Hindi/);
    expect(html).toMatch(/Urdu/);
  });
});
