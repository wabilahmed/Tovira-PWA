import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const parse = (p: string): Document => new DOMParser().parseFromString(read(p), 'text/html');

const EN = 'apps/web/index.html';

describe('[SITE-5] accessibility & landmarks', () => {
  it('the English page has exactly one h1 and the core landmarks', () => {
    const d = parse(EN);
    expect(d.querySelectorAll('h1')).toHaveLength(1);
    expect(d.querySelector('header')).not.toBeNull();
    expect(d.querySelector('main')).not.toBeNull();
    expect(d.querySelector('footer')).not.toBeNull();
    expect(d.querySelector('nav')).not.toBeNull();
  });

  it('every role="img" carries real alt text (aria-label)', () => {
    for (const el of parse(EN).querySelectorAll('[role="img"]')) {
      expect((el.getAttribute('aria-label') ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('the OG image is a real asset with an accessible label', () => {
    const svg = read('apps/web/public/og.svg');
    expect(svg).toContain('<svg');
    expect(svg).toMatch(/aria-label=/);
  });

  it('sections are labelled (each has aria-labelledby or aria-label)', () => {
    const sections = [...parse(EN).querySelectorAll('main section')];
    expect(sections.length).toBeGreaterThan(0);
    for (const s of sections) {
      expect(s.hasAttribute('aria-labelledby') || s.hasAttribute('aria-label')).toBe(true);
    }
  });
});

describe('[SITE-5] meta & SEO', () => {
  it('the English page carries title, description, canonical and hreflang alternates', () => {
    const d = parse(EN);
    expect(d.querySelector('title')?.textContent).toMatch(/Tovira/);
    expect(d.querySelector('meta[name="description"]')?.getAttribute('content')).toMatch(/WhatsApp/);
    expect(d.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://tovira.com/');
    const alternates = [...d.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => l.getAttribute('hreflang'));
    expect(alternates).toContain('en');
    expect(alternates).toContain('x-default');
    expect(alternates).not.toContain('ar'); // English-only: no Arabic alternate
  });

  it('has OpenGraph + Twitter cards pointing at the OG image', () => {
    const d = parse(EN);
    expect(d.querySelector('meta[property="og:title"]')).not.toBeNull();
    expect(d.querySelector('meta[property="og:image"]')?.getAttribute('content')).toMatch(/og\.(png|svg)$/);
    expect(d.querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe('summary_large_image');
    expect(d.querySelector('meta[property="og:locale:alternate"]')?.getAttribute('content')).toBe('ar_AE');
  });
});

describe('[SITE-5] visible focus (brass) in the stylesheet', () => {
  it('defines a visible brass focus ring', () => {
    const css = read('apps/web/src/marketing/site.css');
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/outline:\s*2px solid var\(--brass\)/);
  });
});
