// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { PRIVACY_VERSION, TERMS_VERSION } from '../../api/src/services/legal/versions.js';
import { RequestAccess } from './access/RequestAccess.js';

/**
 * [P75 · owner] Two lawyer-approved lines, word for word.
 * Privacy (version 2026-11-18 by the legal-archive process; the outgoing 2026-11-16 text stays frozen): the WhatsApp
 * line, straight after the anonymous statistics lines ("We keep anonymous statistics about how the product is used.
 * We count anonymous game interactions to improve the page."), which stay together. Nothing else in the wording changes.
 * The request form: the WhatsApp sentence replaces "We use the details above only to review your request."
 */
export const PRIVACY_LINE = 'When you request beta access, we ask for your WhatsApp number. Once your request is approved, we use it to verify that the number is yours and to link it to your Tovira account, so you can send chat exports to Tovira on WhatsApp. Messages and files you send to Tovira\'s WhatsApp number pass through Meta\'s WhatsApp Business Platform, which acts as our service provider, before they reach us.';
export const FORM_LINE = 'We use the details above to review your request and, if it\'s approved, to verify your WhatsApp number.';
const STATS = 'We keep anonymous statistics about how the product is used. We count anonymous game interactions to improve the page.';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const bodyText = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent!.replace(/\s+/g, ' ').trim();

describe('[P75] the Privacy page: the WhatsApp line', () => {
  const page = read('apps/web/privacy/index.html');
  it('has the line, word for word, once, straight after the anonymous statistics lines', () => {
    expect(bodyText(page)).toContain(`${STATS} ${PRIVACY_LINE} Your conversations are kept`);
    expect(bodyText(page).split(PRIVACY_LINE)).toHaveLength(2);
  });
  it('is version 2026-11-18, last updated 18 November 2026; the Terms version is unchanged', () => {
    expect(PRIVACY_VERSION).toBe('2026-11-18');
    expect(page).toContain('data-doc-version="2026-11-18">Last updated: 18 November 2026 · Version 2026-11-18</p>');
    expect(TERMS_VERSION).toBe('2026-11-17');
  });
  it('only that line (and the date and version) changed from the 2026-11-16 wording, which stays archived', () => {
    const before = read('legal-archive/2026-11-16/privacy.html');
    expect(before).not.toContain('WhatsApp number');
    const strip = (t: string) => t.replace(` ${PRIVACY_LINE}`, '').replace(/Last updated: [^·]+· Version [\d-]+/, 'STAMP');
    expect(strip(bodyText(page))).toBe(strip(bodyText(before)));
  });
  it('the new wording is frozen in legal-archive/2026-11-18', () => {
    expect(bodyText(read('legal-archive/2026-11-18/privacy.html'))).toBe(bodyText(page));
  });
});

describe('[P75] the request form: the WhatsApp sentence', () => {
  // [P90 · owner, Prompt 88, batch 1] moved: the form is three steps and the sentence sits on the last one, by the
  // Request access button. The sentence itself is unchanged, character for character.
  it('says the approved line, word for word, and no longer says "only to review your request"', () => {
    render(createElement(RequestAccess, { client: { submit: async () => ({ id: 'x' }) } }));
    const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    type('Full name', 'Dana Rep'); type('Work email', 'dana@example.com'); type('Phone', '+971 50 123 4567'); type('Country code', 'AE'); type('WhatsApp number', '050 123 4567');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    type('Company name', 'Meridian'); type('Role / job title', 'Broker');
    fireEvent.click(screen.getByLabelText('Insurance')); fireEvent.click(screen.getByLabelText('I am employed by it'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const hint = screen.getByText((_, el) => el?.tagName === 'P' && (el.textContent ?? '').startsWith('We use the details above'));
    expect(hint.textContent).toBe(`${FORM_LINE} See our Privacy Policy for how we handle your personal data.`);
    expect(document.body.textContent).not.toContain('only to review your request');
  });
});
