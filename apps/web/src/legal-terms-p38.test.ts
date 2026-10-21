// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * [P38 · owner, 21 Oct] The unnumbered paragraph under 6.9 ("You can buy additional usage at any time. …
 * non-refundable once any of it has been used.") is gone — it contradicted 6.10 ("can't be refunded"). 6.9 and
 * 6.10 are untouched, and exactly one clause speaks about refunding extra usage: 6.10.
 */
const html = readFileSync(resolve(process.cwd(), 'apps/web/terms/index.html'), 'utf8');
const paragraphs = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());

describe('[P38] Terms: one rule for refunding extra usage', () => {
  it('the paragraph under 6.9 is absent', () => {
    expect(html).not.toContain('You can buy additional usage at any time.');
    expect(html).not.toContain('non-refundable once any of it has been used');
  });

  it('exactly one clause mentions refunds of extra usage — 6.10', () => {
    const extraUsageRefund = paragraphs.filter((p) => /refund/i.test(p) && /(extra|additional) usage/i.test(p));
    expect(extraUsageRefund).toHaveLength(1);
    expect(extraUsageRefund[0]).toMatch(/^6\.10 Extra usage you buy doesn't expire/);
  });

  it('6.9 and 6.10 are unchanged', () => {
    expect(html).toContain('<p><strong>6.9 Usage allowance.</strong> Your subscription includes a monthly allowance of AI processing, shown in the app as a percentage.');
    expect(html).toContain("<p><strong>6.10</strong> Extra usage you buy doesn't expire while your account exists. It is used only after your monthly allowance, works only while you have an active subscription, can't be refunded or exchanged for cash, and is lost if you delete your account.</p>");
  });

  it('the page says it was last updated on 21 October 2026', () => {
    expect(html).toContain('Last updated: 21 October 2026 · Version 2026-10-21');
  });
});
