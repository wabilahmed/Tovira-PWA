/**
 * STAGING-2 — account & access. Covers FLOWS 1, 2, 3b, 3c. The negatives ARE the
 * product's trust rules: no user enumeration (status, body, AND timing), referral
 * integrity, no trial farming, soft verification (unverified ≠ locked out), and the
 * email/session doctrine. Inbox-gated steps (a real verify/reset token) are marked
 * UNREACHABLE-BY-API with the reason (rail #5) rather than faked.
 */
import { describe, it, expect } from 'vitest';
import { useHarness } from './lib/harness.js';

const h = useHarness();

interface BillingStatus {
  entitled: boolean;
  status: string;
  trialEndsAt: number | null;
  renewsAt: number | null;
}
const DAY = 24 * 60 * 60 * 1000;

async function trialEndsAt(token: string): Promise<number> {
  const res = await h.anon.request<BillingStatus>('GET', '/billing/status', undefined, {
    headers: { authorization: `Bearer ${token}` },
  });
  return res.body.trialEndsAt ?? 0;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

describe('[STAGING-2] account & access', () => {
  // ---- FLOW 1: signup ----
  it('signup creates a trialing, unverified account with an opaque referral code', async () => {
    const rep = await h.factory.newRep();
    const me = await rep.http.get<{ user: { emailVerified: boolean; referralCode: string; id: string } }>('/me');
    expect(me.status).toBe(200);
    expect(me.body.user.emailVerified).toBe(false);
    expect(me.body.user.referralCode).toBeTruthy();
    expect(me.body.user.referralCode).not.toBe(me.body.user.id); // opaque, not the raw id
    const st = await rep.http.get<BillingStatus>('/billing/status');
    expect(st.body.status).toBe('trialing');
    expect(st.body.entitled).toBe(true);
    h.report.pass('A', 'FLOW 1', 'signup → trialing, unverified, opaque referral code');
  });

  it('signup negatives: duplicate → 409, weak password → 400, consent:false → 400', async () => {
    const rep = await h.factory.newRep();
    const dup = await h.anon.post('/auth/signup', { email: rep.email, password: rep.password, consent: true });
    expect(dup.status).toBe(409);
    const weak = await h.anon.post('/auth/signup', { email: h.factory.email(), password: '123', consent: true });
    expect(weak.status).toBe(400);
    const noConsent = await h.anon.post('/auth/signup', { email: h.factory.email(), password: h.factory.strongPassword(), consent: false });
    expect(noConsent.status).toBe(400);
    h.report.pass('A', 'FLOW 1', 'signup negatives (409 dup / 400 weak / 400 consent)');
  });

  // ---- FLOW 2: login / logout ----
  it('login then logout: session issued, then cleared (dead afterwards)', async () => {
    const rep = await h.factory.newRep();
    await rep.http.post('/auth/logout'); // start clean
    const login = await rep.http.post<{ token: string }>('/auth/login', { email: rep.email, password: rep.password });
    expect(login.status).toBe(200);
    expect(rep.http.sessionCookie()).toBeTruthy();
    const logout = await rep.http.post('/auth/logout');
    expect(logout.status).toBe(200);
    expect(rep.http.sessionCookie()).toBeFalsy(); // cleared cookie dropped from the jar
    const after = await rep.http.get('/me');
    expect(after.status).toBe(401);
    h.report.pass('A', 'FLOW 2', 'login → logout → session dead');
  });

  // ---- NO ENUMERATION (the trust rule): status, body, AND timing ----
  it('wrong password vs unknown email are indistinguishable (status, body, timing)', async () => {
    // Login is rate-limited per (ip,email) (~8/15min). To sample the wrong-password
    // path without tripping it, rotate across several real accounts, ≤5 attempts each.
    const reps = await Promise.all([h.factory.newRep(), h.factory.newRep(), h.factory.newRep(), h.factory.newRep()]);
    const perAccount = 5;
    const wrongTimes: number[] = [];
    const unknownTimes: number[] = [];
    let wrongBody = '';
    let unknownBody = '';
    let wrongStatus = 0;
    let unknownStatus = 0;
    let n = 0;
    for (const rep of reps) {
      for (let i = 0; i < perAccount; i++) {
        const w = await h.anon.post('/auth/login', { email: rep.email, password: `NopeNope${i}!x` });
        wrongTimes.push(w.durationMs);
        wrongBody = w.rawText;
        wrongStatus = w.status;
        // Unknown email: a unique ghost each time so the limiter never trips.
        const u = await h.anon.post('/auth/login', { email: `qa+${h.factory.runId}-ghost${n++}@qa.tovira.io`, password: `NopeNope${i}!x` });
        unknownTimes.push(u.durationMs);
        unknownBody = u.rawText;
        unknownStatus = u.status;
      }
    }
    const N = wrongTimes.length;
    // Status + body must be byte-identical (no oracle in the response itself).
    expect(wrongStatus).toBe(401);
    expect(unknownStatus).toBe(401);
    expect(unknownBody).toBe(wrongBody);
    // Timing: no meaningful gap. A skipped password hash on the unknown path would
    // show as a large median gap; assert it stays small (record the numbers).
    const mWrong = median(wrongTimes);
    const mUnknown = median(unknownTimes);
    const gap = Math.abs(mWrong - mUnknown);
    h.report.record({
      part: 'A',
      flow: 'FLOW 2',
      name: 'no-enumeration timing',
      outcome: gap < 200 ? 'PASS' : 'FAIL',
      detail: `median wrong=${mWrong.toFixed(0)}ms unknown=${mUnknown.toFixed(0)}ms gap=${gap.toFixed(0)}ms (n=${N})`,
      stopTheLine: false,
    });
    expect(gap).toBeLessThan(200);
    h.report.pass('A', 'FLOW 2', 'no-enumeration status+body identical');
  });

  // ---- SOFT VERIFICATION: an unverified rep is NEVER locked out ----
  it('an unverified trialing rep is entitled on gated endpoints (soft verification)', async () => {
    const rep = await h.factory.newRep();
    const me = await rep.http.get<{ user: { emailVerified: boolean } }>('/me');
    expect(me.body.user.emailVerified).toBe(false); // provably unverified
    const gated = await rep.http.get('/book-scan'); // entitlement-gated surface
    expect(gated.status).not.toBe(401);
    expect(gated.status).not.toBe(402); // NOT locked out despite being unverified
    expect(gated.status).toBe(200);
    h.report.pass('A', 'FLOW 3c', 'soft verification — unverified rep entitled on /book-scan');
  });

  // ---- REFERRAL INTEGRITY (P5-6) ----
  it('a valid referral credits both parties ~30 days; garbage credits nobody', async () => {
    const control = await h.factory.newRep();
    const controlEnd = await trialEndsAt(control.token);

    const referrer = await h.factory.newRep();
    const refCode = (await referrer.http.get<{ user: { referralCode: string } }>('/me')).body.user.referralCode;
    const referrerBefore = await trialEndsAt(referrer.token);

    // Sign up the referred rep WITH the ref via a raw call so we can observe the
    // status (staging may 500) and adopt the account for teardown regardless.
    const email = h.factory.email();
    const password = h.factory.strongPassword();
    const signup = await h.anon.post('/auth/signup', { email, password, consent: true, ref: refCode });
    const referred = await h.factory.adopt(email, password); // recover even if 500 orphaned it

    // Garbage code control: signup succeeds, nobody credited (== control window).
    const garbage = await h.factory.newRep({ ref: 'totally-bogus-code-xyz' });
    const garbageEnd = await trialEndsAt(garbage.token);
    expect(Math.abs(garbageEnd - controlEnd)).toBeLessThan(2 * DAY);
    h.report.pass('A', 'P5-6', 'garbage referral credits nobody (signup still 201)');

    // FINDING: a VALID referral must succeed (201) and credit both parties. On
    // staging this returns 500 and credits no one — the growth loop is broken.
    if (signup.status !== 201) {
      h.report.fail('A', 'P5-6', 'valid referral signup',
        `expected 201, got ${signup.status} — referral credit path 500s for a real referrer (P5-6 growth loop broken on staging)`,
        h.anon.lastExchange());
    }
    expect(signup.status, 'valid referral signup should be 201, not a 500').toBe(201);

    // Only reached once staging is fixed — the credit assertions.
    const referredEnd = await trialEndsAt(referred!.token);
    const referrerAfter = await trialEndsAt(referrer.token);
    expect(referredEnd - controlEnd).toBeGreaterThan(25 * DAY);
    expect(referrerAfter - referrerBefore).toBeGreaterThan(25 * DAY);
    h.report.pass('A', 'P5-6', 'valid referral credits both ~30d',
      `+${((referredEnd - controlEnd) / DAY).toFixed(0)}d referred, +${((referrerAfter - referrerBefore) / DAY).toFixed(0)}d referrer`);
  });

  it('a referral cannot create a duplicate account: re-signup on the same email → 409', async () => {
    const referrer = await h.factory.newRep();
    const refCode = (await referrer.http.get<{ user: { referralCode: string } }>('/me')).body.user.referralCode;
    const email = h.factory.email();
    const password = h.factory.strongPassword();
    // First referred signup (may 500 on staging, but still creates the row).
    await h.anon.post('/auth/signup', { email, password, consent: true, ref: refCode });
    await h.factory.adopt(email, password); // for teardown
    // A second signup on the same email must be rejected — no duplicate account,
    // no chance of a second credit. This holds regardless of the 500 above.
    const again = await h.anon.post('/auth/signup', { email, password, consent: true, ref: refCode });
    expect(again.status).toBe(409);
    h.report.pass('A', 'P5-6', 'no duplicate account on re-signup (409)');
  });

  // ---- NO TRIAL FARMING ----
  it('delete + re-signup on the same email does NOT grant a fresh trial', async () => {
    const email = h.factory.email();
    const first = await h.factory.newRep({ emailOverride: email });
    const firstEnd = await trialEndsAt(first.token);
    const del = await first.http.del('/account');
    expect(del.status).toBe(200);
    // Re-signup on the same email — the durable email grant must be reused.
    const second = await h.factory.newRep({ emailOverride: email });
    const secondEnd = await trialEndsAt(second.token);
    // A fresh trial would push the end ~7 days past the original; farming is blocked
    // when the new end matches the original grant (not reset to now+7).
    expect(Math.abs(secondEnd - firstEnd)).toBeLessThan(2 * DAY);
    h.report.pass('A', 'FLOW 1', 'no trial farming (durable email grant reused)',
      `Δend=${((secondEnd - firstEnd) / DAY).toFixed(2)}d`);
  });

  // ---- RESEND VERIFICATION RATE LIMIT ----
  it('verification resend is rate-limited within a day (eventually 429)', async () => {
    const rep = await h.factory.newRep();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await rep.http.post('/auth/resend-verification');
      codes.push(r.status);
      if (r.status === 429) break;
    }
    expect(codes).toContain(429); // the limiter trips within a handful of calls
    h.report.pass('A', 'FLOW 3c', 'resend verification rate-limited (429)', `sequence: ${codes.join(',')}`);
  });

  // ---- VERIFY-EMAIL token negatives (garbage testable; real tokens inbox-gated) ----
  it('verify-email rejects a garbage token with 400 (no oracle)', async () => {
    const g1 = await h.anon.post('/auth/verify-email', { token: 'garbage-not-a-token' });
    expect(g1.status).toBe(400);
    const g2 = await h.anon.get('/auth/verify-email?token=another-bad-one');
    expect(g2.status).toBe(400);
    h.report.pass('A', 'FLOW 3c', 'verify-email garbage → 400');
    h.report.unreachable('A', 'FLOW 3c', 'expired/reused/cross-user verify token',
      'a real verification token is delivered only by email; not retrievable via API (rail #5)');
  });

  // ---- PASSWORD RESET (FLOW 3b) ----
  it('forgot-password is non-revealing (same 200) for known and unknown emails', async () => {
    const rep = await h.factory.newRep();
    const known = await h.anon.post('/auth/forgot-password', { email: rep.email });
    const unknown = await h.anon.post('/auth/forgot-password', { email: `qa+${h.factory.runId}-ghost-reset@qa.tovira.io` });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.rawText).toBe(unknown.rawText);
    h.report.pass('A', 'FLOW 3b', 'forgot-password non-revealing (identical 200)');
  });

  it('reset-password rejects a garbage token', async () => {
    const bad = await h.anon.post('/auth/reset-password', { token: 'not-a-real-token', password: h.factory.strongPassword() });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    h.report.pass('A', 'FLOW 3b', 'reset-password garbage token rejected');
    h.report.unreachable('A', 'FLOW 3b', 'reused token + all-sessions-dead-after-reset',
      'completing a reset needs the emailed token; not retrievable via API (rail #5)');
  });
});
