import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ARABIC = /[؀-ۿ]/;
const html = readFileSync(resolve(process.cwd(), 'apps/site/ar/index.html'), 'utf8');
function doc(): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('[SITE-4] Arabic page /ar — RTL scaffold, not machine-translated', () => {
  it('is a right-to-left Arabic document (the layout mirrors)', () => {
    const el = doc().documentElement;
    expect(el.getAttribute('dir')).toBe('rtl');
    expect(el.getAttribute('lang')).toBe('ar');
  });

  it('renders receipts right-to-left (the chit is one component, RTL included)', () => {
    const rtl = doc().querySelectorAll('.tov-receipt__rtl');
    expect(rtl.length).toBeGreaterThan(0);
    for (const el of rtl) {
      expect(el.getAttribute('dir')).toBe('rtl');
      expect(ARABIC.test(el.textContent ?? '')).toBe(true);
    }
  });

  it('handles bidi: Latin brand terms and numbers sit inside an Arabic run', () => {
    const sample = doc().querySelector('.tov-receipt__rtl')!;
    const text = sample.textContent ?? '';
    expect(ARABIC.test(text)).toBe(true); // Arabic
    expect(text).toContain('Tovira'); // Latin brand term
    expect(text).toContain('299'); // a number
  });

  it('keeps the mono stamp LTR/Latin inside the RTL chit (§3 bidi rule)', () => {
    const stamp = doc().querySelector('.tov-receipt .tov-stamp')!;
    expect(stamp.textContent).toContain('WHATSAPP · 14 MAR 2026');
    expect(ARABIC.test(stamp.textContent ?? '')).toBe(false);
  });

  it('marks every section TRANSLATION NEEDED with its English source (no invented Arabic copy)', () => {
    const d = doc();
    const markers = [...d.querySelectorAll('.xlate')].filter((m) => /TRANSLATION NEEDED/.test(m.textContent ?? ''));
    expect(markers.length).toBe(12); // one per landing section
    const sources = [...d.querySelectorAll('blockquote.source')];
    expect(sources.length).toBe(12);
    for (const s of sources) {
      expect(s.getAttribute('dir')).toBe('ltr'); // English source pinned LTR for the copywriter
      expect(s.getAttribute('lang')).toBe('en');
    }
  });

  it('the language switch returns to the English page (and carries the ref via the enhancer)', () => {
    const langs = [...doc().querySelectorAll<HTMLAnchorElement>('[data-langswitch]')];
    expect(langs.length).toBeGreaterThan(0);
    for (const a of langs) expect(a.getAttribute('href')).toBe('/');
  });

  it('still ships working CTAs to the app', () => {
    const ctas = [...doc().querySelectorAll<HTMLAnchorElement>('[data-cta]')];
    expect(ctas.length).toBeGreaterThan(0);
    for (const a of ctas) expect(a.getAttribute('href')).toBe('https://app.tovira.com/');
  });
});
