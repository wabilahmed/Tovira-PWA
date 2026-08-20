import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withParams, withAppUrl, enhanceLinks } from './ref.js';

const APP = '/app';
const ORIGIN = 'https://tovira.com';

// The real shipped page — the test runs against the actual CTAs, not a fixture,
// so a CTA that loses its data-cta or its app href fails here. (Resolved from
// cwd: vitest runs from the repo root, and the jsdom env makes import.meta.url
// a non-file URL.)
const html = readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
function pageDoc(): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('withParams', () => {
  it('appends incoming params to an absolute app URL', () => {
    expect(withParams(APP, '?ref=abc123', ORIGIN)).toBe('/app?ref=abc123');
  });
  it('carries multiple params (ref + utm) through unchanged', () => {
    const out = withParams(APP, '?ref=abc123&utm_source=x&utm_campaign=y', ORIGIN);
    expect(out).toContain('ref=abc123');
    expect(out).toContain('utm_source=x');
    expect(out).toContain('utm_campaign=y');
  });
  it('adds no query when there is none', () => {
    expect(withParams(APP, '', ORIGIN)).toBe('/app');
  });
});

describe('withAppUrl (env override)', () => {
  it('swaps the origin for the configured app URL, keeping the path/query', () => {
    expect(withAppUrl('/app', ORIGIN, 'https://staging.tovira.dev')).toBe('https://staging.tovira.dev/app');
  });
  it('is a no-op when no app URL is configured', () => {
    expect(withAppUrl(APP, ORIGIN, undefined)).toBe(APP);
  });
});

describe('[SITE-3] referral pass-through on the real page (the growth loop)', () => {
  it('carries ?ref= through to EVERY CTA', () => {
    const doc = pageDoc();
    enhanceLinks(doc, '?ref=abc123', ORIGIN);
    const ctas = [...doc.querySelectorAll<HTMLAnchorElement>('[data-cta]')];
    expect(ctas.length).toBeGreaterThan(0);
    for (const a of ctas) {
      expect(a.getAttribute('href')).toContain('ref=abc123');
      expect(a.getAttribute('href')!.startsWith('/app')).toBe(true);
    }
  });

  it('preserves utm_* params alongside ref, unmodified', () => {
    const doc = pageDoc();
    enhanceLinks(doc, '?ref=abc123&utm_source=insta&utm_medium=bio', ORIGIN);
    for (const a of doc.querySelectorAll<HTMLAnchorElement>('[data-cta]')) {
      const href = a.getAttribute('href')!;
      expect(href).toContain('ref=abc123');
      expect(href).toContain('utm_source=insta');
      expect(href).toContain('utm_medium=bio');
    }
  });

  // NEGATIVE: no ref in → no stray ?ref= (or any query) on the CTAs.
  it('adds no stray query when the landing URL has none', () => {
    const doc = pageDoc();
    enhanceLinks(doc, '', ORIGIN);
    for (const a of doc.querySelectorAll<HTMLAnchorElement>('[data-cta]')) {
      expect(a.getAttribute('href')).toBe('/app');
      expect(a.getAttribute('href')).not.toContain('?');
    }
  });

  // The English landing no longer links to /ar (the untranslated page). The
  // remaining language switch — on /ar, back to English — must still carry the ref.
  it('the English page has no Arabic language switch', () => {
    expect(pageDoc().querySelectorAll('[data-langswitch]')).toHaveLength(0);
  });

  it('the /ar → English switch carries the ref (no attribution lost across languages)', () => {
    const arHtml = readFileSync(resolve(process.cwd(), 'apps/web/ar/index.html'), 'utf8');
    const doc = new DOMParser().parseFromString(arHtml, 'text/html');
    enhanceLinks(doc, '?ref=abc123', ORIGIN);
    const langs = [...doc.querySelectorAll<HTMLAnchorElement>('[data-langswitch]')];
    expect(langs.length).toBeGreaterThan(0);
    for (const a of langs) expect(a.getAttribute('href')).toContain('ref=abc123');
  });

  // The plain-link guarantee: without any JS, the CTAs already point at the app.
  it('ships CTAs that work with no JS (absolute app hrefs in the source HTML)', () => {
    const doc = pageDoc();
    const ctas = [...doc.querySelectorAll<HTMLAnchorElement>('[data-cta]')];
    for (const a of ctas) expect(a.getAttribute('href')).toBe('/app');
  });
});
