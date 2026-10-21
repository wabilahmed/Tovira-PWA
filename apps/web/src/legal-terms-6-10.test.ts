// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * [P37 · owner, 20 Oct] The lawyer-verified extra-usage sentence, word for word, as clause 6.10 of the rendered
 * Terms (right after the 6.9 usage-allowance clause, in "6. Price and payment"). Not one character may change.
 */
const SENTENCE = "Extra usage you buy doesn't expire while your account exists. It is used only after your monthly allowance, works only while you have an active subscription, can't be refunded or exchanged for cash, and is lost if you delete your account.";
const html = readFileSync(resolve(process.cwd(), 'apps/web/terms/index.html'), 'utf8');
const text = (h: string) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

describe('[P37] Terms 6.10 — the extra-usage sentence, verbatim', () => {
  it('is in the rendered Terms exactly, as clause 6.10', () => {
    expect(text(html)).toContain(`6.10 ${SENTENCE}`);
    expect(html).toContain(`<p><strong>6.10</strong> ${SENTENCE}</p>`);
  });

  it('sits in "6. Price and payment", after 6.9 and before section 7', () => {
    const six = html.indexOf('<h2>6. Price and payment</h2>');
    const nine = html.indexOf('<strong>6.9 Usage allowance.</strong>');
    const ten = html.indexOf('<strong>6.10</strong>');
    const seven = html.indexOf('<h2>7. Limits and availability</h2>');
    expect(six).toBeGreaterThan(-1);
    expect(six < nine && nine < ten && ten < seven).toBe(true);
  });

  // [P38] The Terms changed again on 21 Oct (the contradicting paragraph under 6.9 removed), so the page's date
  // moved on; 6.10 itself is still pinned above, and the current date by legal-terms-p38.test.ts.
  it('the page carries a dated version marker no earlier than 6.10 (20 October 2026)', () => {
    const v = /data-doc-version="(\d{4}-\d{2}-\d{2})"/.exec(html)?.[1] ?? '';
    expect(v >= '2026-10-20').toBe(true);
  });
});
