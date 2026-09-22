import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const parse = (p: string): Document => new DOMParser().parseFromString(read(p), 'text/html');

const PRIVACY = 'apps/web/privacy/index.html';
const TERMS = 'apps/web/terms/index.html';

// [SITE / LEGAL] These pages are now PUBLISHED (owner-approved final text, all four publish gates green
// in production). The test flipped from guarding "honest draft skeleton" to guarding the published
// state: no draft/noindex markers, and every mandated protection actually present in the shipped copy.
describe('[SITE / LEGAL] Privacy & Terms are published, not drafts', () => {
  it('both pages are published: one h1, and NO noindex / LAWYER / Draft markers', () => {
    for (const p of [PRIVACY, TERMS]) {
      const d = parse(p);
      const raw = read(p);
      expect(d.querySelectorAll('h1')).toHaveLength(1);
      // Published: indexable (the noindex meta is gone) and no draft scaffolding.
      expect(d.querySelector('meta[name="robots"]')).toBeNull();
      expect(raw).not.toMatch(/LAWYER REVIEW REQUIRED/i);
      expect(raw).not.toMatch(/·\s*Draft/i);
    }
  });

  it('privacy covers the mandated topics with real, shipped text', () => {
    const t = read(PRIVACY);
    // Third-party (non-user) client data.
    expect(t).toMatch(/you are not a user|messages written by your clients/i);
    // Every sub-processor named, with processing locations.
    for (const sub of ['Amazon Web Services', 'Anthropic', 'Groq', 'Stripe', 'Resend']) expect(t).toContain(sub);
    expect(t).toContain('eu-north-1'); // where data is held
    expect(t).toMatch(/stored in Sweden/i);
    // The training stance, retention, and data-subject controls.
    expect(t).toMatch(/do not (keep|retain).{0,40}train AI models|not to train models/i);
    expect(t).toMatch(/how long we keep/i);
    expect(t).toMatch(/export is built into Tovira/i);
    expect(t).toMatch(/delete your account/i);
    // The protections we actually ship (verified against production before publishing).
    expect(t).toMatch(/do not record health information as facts/i);
    expect(t).toMatch(/removes Emirates ID numbers, card numbers, IBANs/i); // deterministic redaction
    expect(t).toMatch(/fewer than 20 reps or clients/i); // k-anonymity floor = 20
    expect(t).toMatch(/UAE Data Office/i); // the regulator to complain to
  });

  it('terms flags third-party data responsibility, billing, erasure and export-before-delete', () => {
    const t = read(TERMS);
    expect(t).toMatch(/legal right to upload every conversation/i); // the rep warrants the right
    expect(t).toMatch(/you are the data controller/i);
    expect(t).toMatch(/AED 299/);
    expect(t).toMatch(/third-party erasure requests/i); // 4.9
    expect(t).toMatch(/export your data first/i); // 12.4 — deletion is immediate
  });

  it('[LEGAL-REVIEW] terms carry the revised clauses (4.4g, 4.6, 4.7, 4.9, 6.2, 6.6, 10.1-10.3, 13.3)', () => {
    const t = read(TERMS);
    expect(t).toMatch(/Voice notes are for your own record of a meeting/i); // 4.4(g)
    expect(t).toMatch(/we record your organisation, your role, and the basis/i); // 4.6 reasonable checks
    expect(t).toMatch(/may suspend or remove content we reasonably believe/i); // 4.6 suspend suspect content
    expect(t).toMatch(/only to the extent they are caused by your breach/i); // 4.7 indemnity narrowed
    expect(t).toMatch(/does not cover loss caused by us/i); // 4.7 excludes our own loss
    expect(t).toMatch(/During that period we restrict processing of the disputed data/i); // 4.9 restrict
    expect(t).toMatch(/Telling us is not a veto/i); // 4.9 no veto
    expect(t).toMatch(/free trial does not reduce anyone's privacy rights/i); // 6.2
    expect(t).toMatch(/A new price applies only from your next renewal/i); // 6.6
    expect(t).toMatch(/mandatory rights under consumer protection and data protection law/i); // 10.1
    expect(t).toMatch(/failed to take reasonable security, backup or restoration measures/i); // 10.2
    expect(t).toMatch(/reasonable care in selecting our suppliers/i); // 10.3 supplier not a blanket defence
    expect(t).toMatch(/does not apply to urgent relief/i); // 13.3 pre-action carve-outs
  });

  it('[LEGAL-REVIEW] terms section 10 is renumbered and the deleted clauses are gone', () => {
    const t = read(TERMS);
    expect(t).toMatch(/10\.5 Basis of the bargain/); // renumbered from 10.6
    expect(t).not.toMatch(/10\.6/); // no clause 10.6 remains
    expect(t).not.toMatch(/10\.5 Time limit/i); // the twelve-month claim bar is deleted
    expect(t).not.toMatch(/must be brought within .{0,20}twelve months/i);
    expect(t).not.toMatch(/incidental to a message you could not reasonably separate/i); // 4.4(f) exception deleted
  });

  it('[LEGAL-REVIEW] privacy erasure section carries the revised promises', () => {
    const t = read(PRIVACY);
    expect(t).toMatch(/we restrict processing of the disputed data while we review it/i); // restrict during review
    expect(t).toMatch(/Their objection is not a veto/i); // no veto
    expect(t).toMatch(/identifying the specific data/i); // asserted exception must be specific
    expect(t).toMatch(/A passing mention can still be personal data/i); // no longer always survives
    expect(t).toMatch(/test whether it could reasonably be reconnected to an individual and record the result/i); // embedding re-id test
    expect(t).not.toMatch(/cannot be turned back into your words/i); // old flat "unreadable" claim removed
    expect(t).toMatch(/complete an erasure within 30 days/i); // 30-day target
    expect(t).not.toMatch(/cannot promise a fixed completion time/i); // "no fixed time" removed
  });

  it('has NO unfilled bracketed placeholder — "[" followed by capitals — in either published page', () => {
    // A published page must never ship a fill-me marker like [DATE] or [CONFIRM REGION]. The legit
    // redaction example "[card ending 4421]" starts lowercase, so it is deliberately not matched.
    for (const p of [PRIVACY, TERMS]) {
      const found = read(p).match(/\[[A-Z][A-Z0-9 _/-]*\]/g) ?? [];
      expect(found, `${p} still contains placeholder(s): ${found.join(', ')}`).toHaveLength(0);
    }
  });

  it('the landing footer links to /privacy and /terms', () => {
    const hrefs = [...parse('apps/web/index.html').querySelectorAll('footer a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/privacy');
    expect(hrefs).toContain('/terms');
  });
});
