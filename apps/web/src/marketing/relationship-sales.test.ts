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
