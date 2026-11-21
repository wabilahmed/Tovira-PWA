import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * [P82-B · owner, 21 Nov] Messages are the only currency reps ever see. No rep-facing string in the app, and none in the
 * server's rep-facing copy (WhatsApp replies, emails, push, the import and allowance routes), contains AED, a $ figure
 * or cost / spend wording. The admin pages are excepted.
 *
 * [P83 · owner, 21 Nov] X approved (10,000 messages on AED 299) and the pending list cleared. "AED only appears on the
 * purchase screen and at checkout": the only files allowed a price are the purchase screens (the packs and the custom
 * amount; the subscription checkout), plus the rep's OWN money (deal values, a client's stated price), which is not
 * Tovira usage. Each is listed with why, so a NEW occurrence anywhere else fails this test.
 */
const WEB = dirname(fileURLToPath(import.meta.url));
const API = join(WEB, '..', '..', 'api', 'src');
const PURCHASE_SCREENS: Record<string, string> = {
  'usage/PurchaseMessages.tsx': 'the purchase screen: the packs and the custom amount, at their prices',
  'usage/purchaseCopy.ts': "the purchase screen's price formatting (\"AED 49.50\")",
  'billing/plans.ts': 'the subscription checkout prices (AED 299 / month, AED 2,990 / year)',
  'billing/Billing.tsx': 'the subscription checkout disclosure "Prices are in AED"',
};
const OWN_MONEY: Record<string, string> = {
  'ledger/Ledger.tsx': "the rep's own deal values (sales won, in AED): their money, not Tovira usage",
  'ledger/ledgerClient.ts': "the deal-value field of the rep's own ledger (their money)",
  'confirm/cardCopy.ts': "a client's price or budget as the rep stated it: their money, not Tovira usage",
};
const ALLOWED: Record<string, string> = { ...PURCHASE_SCREENS, ...OWN_MONEY };
const BANNED = /\bAED\b|\$\s?\d|\bcosts?\b|\bspend(?:ing)?\b|\bspent\b/i;
const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) { if (!['admin', 'node_modules', 'marketing'].includes(n)) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
};
/** The text a rep could see: string and template literals and JSX text, with comments and imports removed. */
function visibleText(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/^import .*$/gm, '');
  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  for (const m of code.matchAll(/>([^<>{}]+)</g)) out.push(m[1]!);
  return out;
}
const offenders = (files: string[], root: string, allowed: Record<string, string>) =>
  files.flatMap((f) => {
    const rel = relative(root, f);
    if (allowed[rel]) return [];
    // a route path ("/admin/costs") or a regex back-reference (", $1, ") is code, not copy
    return visibleText(readFileSync(f, 'utf8')).filter((t) => BANNED.test(t) && !/^\/[\w/-]+$/.test(t.trim()) && !/^[\s,.;:]*\$\d[\s,.;:]*$/.test(t)).map((t) => `${rel}: "${t.slice(0, 90)}"`);
  });

describe('[P82-B] no currency or cost in anything a rep sees', () => {
  it('the app (admin pages and the public marketing pages excepted)', () => {
    expect(offenders(walk(WEB), WEB, ALLOWED)).toEqual([]);
  });
  it("the server's rep-facing copy: WhatsApp replies, emails, push, the import, allowance and processing routes", () => {
    const files = ['services/spend/messages-copy.ts', 'services/import/bulk-upsell.ts', 'services/whatsapp/copy.ts', 'services/email/account-email-service.ts', 'services/import/bulk-batch-notifier.ts', 'services/import/reading-estimate.ts', 'services/import/long-chat.ts', 'http/allowance-routes.ts', 'http/notes-routes.ts', 'http/bulk-import-routes.ts'].map((f) => join(API, f));
    // spendClass / costClass are code identifiers, not copy; console lines are logs, not rep-facing
    const strip = (t: string) => !/^(import|extraction|recall|spend_capped|erasure)$/.test(t) && !/^\[[a-z-]+\]/.test(t);
    expect(offenders(files, API, {}).filter((o) => strip(o.split(': "')[1]!.slice(0, -1)))).toEqual([]);
  });
  it('NEGATIVE: the guard catches a currency line', () => {
    expect(visibleText(`const x = 'You have AED 12 left';`).some((t) => BANNED.test(t))).toBe(true);
    expect(visibleText(`<p>This import will cost about 3 dollars</p>`).some((t) => BANNED.test(t))).toBe(true);
    expect(visibleText(`// AED in a comment is fine\nconst y = 'This chat has 1,240 messages to read.';`).some((t) => BANNED.test(t))).toBe(false);
  });
  it('every allowed file still exists (remove it from the list when it goes)', () => {
    for (const f of Object.keys(ALLOWED)) expect(statSync(join(WEB, f)).isFile(), f).toBe(true);
  });
  it('[P83] the usage copy (meter, banners, tour, processing card) is NOT allowed a price: the pending list is cleared', () => {
    for (const f of ['usage/usageCopy.ts', 'usage/UsageMeter.tsx', 'usage/UsageBanner.tsx', 'tour/Tour.tsx', 'processing/ProcessingCard.tsx', 'import/ImportReview.tsx']) {
      expect(ALLOWED[f], f).toBeUndefined();
    }
  });
});
