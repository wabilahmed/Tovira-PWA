import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const parse = (p: string): Document => new DOMParser().parseFromString(read(p), 'text/html');

const PRIVACY = 'apps/web/privacy/index.html';
const TERMS = 'apps/web/terms/index.html';

describe('[SITE / LEGAL] Privacy & Terms exist and are honest skeletons', () => {
  it('both pages exist with a single h1 and a noindex draft marker', () => {
    for (const p of [PRIVACY, TERMS]) {
      const d = parse(p);
      expect(d.querySelectorAll('h1')).toHaveLength(1);
      expect(d.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex');
    }
  });

  // No invented legal text: every page is explicitly marked as needing a lawyer.
  it('carries LAWYER REVIEW REQUIRED markers (no invented final legal text)', () => {
    expect(read(PRIVACY)).toMatch(/LAWYER REVIEW REQUIRED/);
    expect(read(TERMS)).toMatch(/LAWYER REVIEW REQUIRED/);
    // ...on more than just the header — the risky sections are flagged too.
    expect((read(PRIVACY).match(/LAWYER REVIEW REQUIRED/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('privacy covers the mandated topics: third-party client data, sub-processors, training log, retention, rights, UAE contact', () => {
    const t = read(PRIVACY);
    expect(t).toMatch(/third[- ]part(y|ies)/i);
    expect(t).toMatch(/messages? (written|authored) by your clients|contain messages/i);
    for (const sub of ['Amazon Web Services', 'Anthropic', 'Groq', 'Stripe']) expect(t).toContain(sub);
    expect(t).toMatch(/AWS region/); // processing location flagged
    expect(t).toMatch(/training log/i);
    expect(t).toMatch(/retention/i);
    expect(t).toMatch(/export/i);
    expect(t).toMatch(/delete your account/i);
    expect(t).toMatch(/UAE contact/i);
  });

  it('terms flags third-party data consent and billing', () => {
    const t = read(TERMS);
    expect(t).toMatch(/messages authored by your clients/i);
    expect(t).toMatch(/AED 299/);
  });

  it('the landing footer links to /privacy and /terms (both languages)', () => {
    for (const page of ['apps/web/index.html', 'apps/web/ar/index.html']) {
      const hrefs = [...parse(page).querySelectorAll('footer a')].map((a) => a.getAttribute('href'));
      expect(hrefs).toContain('/privacy');
      expect(hrefs).toContain('/terms');
    }
  });

  it('the Arabic legal pages are RTL scaffolds pointing at the English source', () => {
    for (const p of ['apps/web/ar/privacy/index.html', 'apps/web/ar/terms/index.html']) {
      const d = parse(p);
      expect(d.documentElement.getAttribute('dir')).toBe('rtl');
      expect(read(p)).toMatch(/TRANSLATION NEEDED/);
    }
  });
});
