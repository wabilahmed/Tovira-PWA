// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * [P39-9 · owner] Rep-facing copy never says "moments", "Unsorted", "Worth checking" or "entry/entries" — in the
 * app's strings and JSX text, and in the server copy that reaches a rep (Book Scan headlines, import errors).
 * Comments and identifiers don't count. And the landing page's two lines read as the owner wrote them.
 */
const ROOT = resolve(process.cwd());
const BANNED = /\bmoments\b|\bunsorted\b|worth checking|\bentr(?:y|ies)\b/i;
function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === 'marketing' || f === 'node_modules' ? [] : files(p, ext)) : ext.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}
function repFacingStrings(src: string): string[] {
  const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const out: string[] = [];
  // string literals, template literals, and JSX text — including the runs beside {expressions}
  for (const m of code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`|>([^<>{}\n]+)</g)) out.push((m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim());
  // JSX text beside an {expression}: "Tovira suggests {x}. {y}" — only runs that read as text, not code
  for (const m of code.matchAll(/[>}]([^<>{}\n]+)[<{]/g)) if (!/[=();?&|]/.test(m[1]!)) out.push(m[1]!.trim());
  // identifiers / values like 'unsorted' (the filter's id) and 'worth_checking' (an enum) are not copy
  return out.filter((t) => t.includes(' ') || /^[A-Z]/.test(t) || t.includes('—'));
}

/** [P40-4 · owner] No em-dash (" — ") in rep-facing copy. The server files whose strings reach a rep (Today, alerts,
 *  nudges, Book Scan, the Monday Statement, import notices, emails, API error messages). Exempt, with the reason:
 *  ops-only text. (The erasure notice was checked: not the lawyer's wording, so it follows the rule too.) */
const SERVER_COPY = [
  'apps/api/src/services/hero/hero-service.ts', 'apps/api/src/services/scan/scan-service.ts', 'apps/api/src/services/scheduler/nudge-content.ts',
  'apps/api/src/services/notes/import-completion-service.ts', 'apps/api/src/services/import/bulk-batch-notifier.ts', 'apps/api/src/services/book-scan/book-scan-service.ts',
  'apps/api/src/services/monday/monday-service.ts', 'apps/api/src/services/clients/client-overview.ts', 'apps/api/src/services/email/account-email-service.ts',
  'apps/api/src/services/email/templates.ts', 'apps/api/src/services/find/find-service.ts', 'apps/api/src/services/promises/kept-suggestion-service.ts',
  'apps/api/src/http/hero-routes.ts', 'apps/api/src/http/notes-routes.ts', 'apps/api/src/http/onboarding-routes.ts', 'apps/api/src/http/auth-routes.ts',
  'apps/api/src/services/erasure/erasure-request-service.ts', 'apps/api/src/http/inventory-routes.ts', 'apps/api/src/http/access-request-routes.ts', 'apps/api/src/http/find-routes.ts', 'apps/api/src/http/recall-routes.ts',
];
const DASH_EXEMPT: Array<[RegExp, string]> = [
  [/^This applicant is EMPLOYED/, 'ops email (the operator, not a rep)'],
  [/^Beta access request/, 'ops email subject'],
];
const dashHits = (file: string, rel: string) => repFacingStrings(readFileSync(file, 'utf8'))
  .filter((t) => t.includes(' — ') || t.startsWith('— ') || t.endsWith(' —') || t === '—')
  .filter((t) => !DASH_EXEMPT.some(([re]) => re.test(t)))
  .map((t) => `${rel}: ${t.slice(0, 90)}`);

describe('[P39-9] rep-facing copy', () => {
  it('no "moments", "Unsorted", "Worth checking" or "entry/entries" in the app', () => {
    const hits = files(join(ROOT, 'apps/web/src'), /\.tsx?$/).flatMap((f) => repFacingStrings(readFileSync(f, 'utf8')).filter((t) => BANNED.test(t)).map((t) => `${relative(ROOT, f)}: ${t}`));
    expect(hits).toEqual([]);
  });

  it('…nor in the server copy that reaches a rep (Book Scan, import errors)', () => {
    const surfaces = ['apps/api/src/services/book-scan/book-scan-service.ts', 'apps/api/src/services/import/zip.ts'];
    const hits = surfaces.flatMap((f) => repFacingStrings(readFileSync(join(ROOT, f), 'utf8')).filter((t) => BANNED.test(t)).map((t) => `${f}: ${t}`));
    expect(hits).toEqual([]);
  });

  it('[P40-4] no em-dash in the app\'s rep-facing strings (ops screens excepted)', () => {
    const hits = files(join(ROOT, 'apps/web/src'), /\.tsx?$/).filter((f) => !/\/ops\//.test(f)).flatMap((f) => dashHits(f, relative(ROOT, f)));
    expect(hits).toEqual([]);
  });

  it('[P40-4] no em-dash in the server copy that reaches a rep', () => {
    expect(SERVER_COPY.flatMap((f) => dashHits(join(ROOT, f), f))).toEqual([]);
  });

  // [P42-B7] Owner: generic app copy fits every relationship-sales rep. Property words belong only to a property
  // need's own data (a stored requirement, Find's Property type values), never to labels, examples or empty states.
  it('[P42-B7] no property-only words in generic rep-facing copy (app and server)', () => {
    const PROPERTY = /\b(viewings?|listings?|bedrooms?|BHK|villas?|apartments?|communit(?:y|ies)|RERA|developers?|handover|off-plan|floor plans?|Mirdif|Marina|brokerage)\b/i;
    const app = files(join(ROOT, 'apps/web/src'), /\.tsx?$/).flatMap((f) => repFacingStrings(readFileSync(f, 'utf8')).filter((t) => PROPERTY.test(t)).map((t) => `${relative(ROOT, f)}: ${t}`));
    const server = SERVER_COPY.flatMap((f) => repFacingStrings(readFileSync(join(ROOT, f), 'utf8')).filter((t) => PROPERTY.test(t)).map((t) => `${f}: ${t}`));
    expect([...app, ...server]).toEqual([]);
  });

  it('the landing page: "Cancel anytime from Settings → Subscription" and "One plan. No tiers, no seats to count."', () => {
    const html = readFileSync(join(ROOT, 'apps/web/index.html'), 'utf8');
    expect(html).toContain('Cancel anytime from Settings → Subscription.');
    expect(html).toContain('One plan. No tiers, no seats to count.');
    expect(html).not.toContain('Cancel anytime from Billing');
    expect(html).not.toContain('no add-ons');
  });
});
