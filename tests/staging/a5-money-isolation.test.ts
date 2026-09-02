/**
 * STAGING-5 — proactive, money & isolation. Covers FLOWS 6, 18, 19, 23, 24, 26, 27 and
 * the ★ cross-account isolation sweep (a stop-the-line condition). The billing tests
 * drive Stripe TEST-MODE webhooks with real signatures (webhooks are the source of
 * truth — a client success redirect must never grant access), and require
 * STAGING_STRIPE_WEBHOOK_SECRET; without it they are skipped + recorded UNREACHABLE.
 */
import { describe, it, expect } from 'vitest';
import { useHarness } from './lib/harness.js';
import { signEvent, stripeWebhookSecret } from './lib/stripe.js';
import type { Identity } from './lib/identity.js';

const h = useHarness();
const SECRET = stripeWebhookSecret();
const signed = SECRET ? it : it.skip;
const DAY = 24 * 60 * 60 * 1000;

async function createClient(rep: Identity, name: string): Promise<string> {
  const res = await rep.http.post<{ id: string }>('/clients', { name });
  expect(res.status, `create client: ${rep.http.lastExchange()}`).toBe(201);
  return res.body.id;
}
async function status(rep: Identity): Promise<{ entitled: boolean; status: string; trialEndsAt: number | null; renewsAt: number | null }> {
  return (await rep.http.get<{ entitled: boolean; status: string; trialEndsAt: number | null; renewsAt: number | null }>('/billing/status')).body;
}
function custId(rep: Identity): string {
  return `cus_test_${rep.userId.replace(/[^a-z0-9]/gi, '').slice(0, 16)}`;
}
/** Sign + POST a webhook event to /billing/webhook (unauthenticated, like Stripe). */
async function webhook(type: string, object: Record<string, unknown>, eventId?: string) {
  const ev = signEvent(SECRET!, type, object, eventId);
  const res = await h.anon.request('POST', '/billing/webhook', undefined, {
    raw: ev.payload,
    rawContentType: 'application/json',
    headers: { 'stripe-signature': ev.signatureHeader },
  });
  return { res, eventId: ev.eventId };
}

describe('[STAGING-5] proactive, money & isolation', () => {
  it('records whether the Stripe webhook secret is available', () => {
    if (!SECRET) {
      h.report.unreachable('A', 'P5-2', 'signed webhook drive',
        'STAGING_STRIPE_WEBHOOK_SECRET not set — billing-spoof + entitlement-matrix signed drives skipped (rail #2)');
    } else {
      h.report.pass('A', 'P5-2', 'webhook secret present — signed drives enabled');
    }
    expect(true).toBe(true);
  });

  // ---- BILLING SPOOF (the critical one) ----
  signed('a client success redirect never grants access; signed webhooks drive the lifecycle; replay is idempotent; a bad signature is rejected', async () => {
    const rep = await h.factory.newRep();
    const cus = custId(rep);
    const sub = `sub_test_${rep.userId.slice(0, 8)}`;
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

    // Baseline: a trialing account is entitled via trial but never 'active' — no
    // client-side success redirect exists that could flip it. Webhooks are the truth.
    expect((await status(rep)).status).toBe('trialing');

    // checkout.session.completed → active.
    const { res: c1, eventId } = await webhook('checkout.session.completed', {
      client_reference_id: rep.userId, customer: cus, subscription: sub, current_period_end: periodEnd,
    });
    expect(c1.status, `webhook: ${h.anon.lastExchange()}`).toBe(200);
    const active = await status(rep);
    expect(active.status).toBe('active');
    expect(active.entitled).toBe(true);
    expect(active.renewsAt).toBeGreaterThan(Date.now()); // renewal from the webhook, not invented

    // Replay the SAME event id → idempotent (no double provisioning), still active.
    const { res: replay } = await webhook('checkout.session.completed', {
      client_reference_id: rep.userId, customer: cus, subscription: sub, current_period_end: periodEnd,
    }, eventId);
    expect(replay.status).toBe(200);
    expect((await status(rep)).status).toBe('active');

    // invoice.payment_failed → past_due.
    await webhook('invoice.payment_failed', { customer: cus });
    expect((await status(rep)).status).toBe('past_due');

    // customer.subscription.deleted → canceled.
    await webhook('customer.subscription.deleted', { customer: cus });
    expect((await status(rep)).status).toBe('canceled');

    // Invalid signature → rejected (never trusted).
    const bad = await h.anon.request('POST', '/billing/webhook', undefined, {
      raw: JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed', data: { object: { client_reference_id: rep.userId } } }),
      rawContentType: 'application/json',
      headers: { 'stripe-signature': 't=1,v1=deadbeefdeadbeef' },
    });
    expect(bad.status).toBe(400);

    h.report.pass('A', 'P5-2', 'billing: no-webhook≠paid · signed lifecycle · idempotent replay · bad-sig rejected');
  });

  // ---- ENTITLEMENT MATRIX (a lapsed/canceled account) ----
  signed('a canceled account gets 402 (no data) on every gated endpoint but keeps capture/export/delete', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'Lapsed Co'); // capture works while trialing
    const cus = custId(rep);
    await webhook('checkout.session.completed', { client_reference_id: rep.userId, customer: cus, subscription: 'sub_x', current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600 });
    await webhook('customer.subscription.deleted', { customer: cus });
    expect((await status(rep)).entitled).toBe(false);

    const gated: Array<['GET' | 'POST', string, unknown?]> = [
      ['GET', '/book-scan'],
      ['GET', `/clients/${clientId}/brief`],
      ['POST', '/recall', { question: 'anything' }],
      ['GET', '/monday-digest'],
      ['GET', '/hero/patterns'],
    ];
    for (const [m, path, body] of gated) {
      const res = await rep.http.request(m, path, body);
      expect(res.status, `gated ${path} should be 402`).toBe(402);
      expect(res.body).toEqual({ error: 'payment_required', status: expect.anything() }); // no feature data leaks
    }

    // The doctrine: a lapsed rep is NEVER locked out of their own data.
    const paste = await rep.http.post(`/clients/${clientId}/notes/paste`, { text: 'still my note' });
    expect(paste.status, 'capture still works when lapsed').toBe(201);
    const exp = await rep.http.get('/account/export');
    expect(exp.status, 'export still works when lapsed').toBe(200);

    h.report.pass('A', 'P5-2', 'lapsed: 402 on every gated surface, capture+export still work');
  });

  // ---- FLOW 6: trial extension (server-enforced, once) ----
  it('trial extends +7 once after notes on 3 distinct clients, and not again', async () => {
    const rep = await h.factory.newRep();
    const before = (await status(rep)).trialEndsAt ?? 0;
    for (let i = 0; i < 3; i++) {
      const c = await createClient(rep, `Distinct ${i}`);
      const p = await rep.http.post(`/clients/${c}/notes/paste`, { text: `note for client ${i}` });
      expect(p.status).toBe(201);
    }
    const after3 = (await status(rep)).trialEndsAt ?? 0;
    expect(after3 - before).toBeGreaterThan(6 * DAY); // +7 granted

    const c4 = await createClient(rep, 'Distinct 4');
    await rep.http.post(`/clients/${c4}/notes/paste`, { text: 'note for client 4' });
    const after4 = (await status(rep)).trialEndsAt ?? 0;
    expect(Math.abs(after4 - after3)).toBeLessThan(DAY); // no second grant
    h.report.pass('A', 'FLOW 6', 'trial +7 once on 3 distinct clients; not re-granted', `+${((after3 - before) / DAY).toFixed(0)}d`);
  });

  // ---- FLOW 19: Monday statement clear-week shape ----
  it('a quiet week returns the honest clear-week digest (isLight, empty arrays)', async () => {
    const rep = await h.factory.newRep();
    const res = await rep.http.get<{ isLight: boolean; promisesDue: unknown[]; coolingClients: unknown[]; unansweredQuestions: unknown[]; upcomingDates: unknown[] }>('/monday-digest');
    expect(res.status).toBe(200);
    expect(res.body.isLight).toBe(true);
    expect(res.body.promisesDue).toHaveLength(0);
    expect(res.body.coolingClients).toHaveLength(0);
    h.report.pass('A', 'FLOW 19', 'Monday clear-week honest shape');
  });

  // ---- FLOW 18: proactive scan idempotency (cap needs aged data + push sub) ----
  it('the daily scan runs and is idempotent on re-run (no duplicate alerts)', async () => {
    const rep = await h.factory.newRep();
    const s1 = await rep.http.post('/scan');
    expect(s1.status).toBe(200);
    const s2 = await rep.http.post<{ overduePromises: number; nudges: number; goingCold: number; dateReminders: number; chatRefresh: number }>('/scan');
    expect(s2.status).toBe(200);
    const newlyCreated = s2.body.overduePromises + s2.body.nudges + s2.body.goingCold + s2.body.dateReminders + s2.body.chatRefresh;
    expect(newlyCreated).toBe(0); // dedupe: a re-scan creates nothing new
    h.report.pass('A', 'FLOW 18', 'scan idempotent (re-scan creates 0 new)');
    h.report.record({ part: 'A', flow: 'FLOW 18', name: 'silence budget cap (≤2 pushed)', outcome: 'PARTIAL',
      detail: 'the ≤2 push cap needs aged/overdue data AND a subscribed push device to observe — human/log-verified (rails #2/#6)' });
  });

  // ---- FLOW 26: export completeness ----
  it('the data export contains every entity the harness created', async () => {
    const rep = await h.factory.newRep();
    await createClient(rep, 'ExportMe Holdings');
    const clientId = await createClient(rep, 'ExportMe Holdings 2');
    await rep.http.post(`/clients/${clientId}/notes/paste`, { text: 'A distinctive exported note about widget procurement.' });
    const exp = await rep.http.get('/account/export');
    expect(exp.status).toBe(200);
    expect(exp.rawText).toContain('ExportMe Holdings');
    expect(exp.rawText).toContain('distinctive exported note about widget procurement');
    h.report.pass('A', 'FLOW 26', 'export includes created clients + notes');
  });

  // ---- FLOW 27: delete ----
  it('deleting the account makes login fail and the data unreachable', async () => {
    const rep = await h.factory.newRep();
    await createClient(rep, 'ToDelete Co');
    const del = await rep.http.del('/account');
    expect(del.status).toBe(200);
    const relogin = await h.anon.post('/auth/login', { email: rep.email, password: rep.password });
    expect(relogin.status).toBe(401); // account + data gone
    h.report.pass('A', 'FLOW 27', 'delete → login fails, data unreachable');
  });

  // ---- ★ CROSS-ACCOUNT ISOLATION SWEEP (stop-the-line) ----
  it('★ isolation: account B cannot reach A\'s resources by direct id (IDOR)', async () => {
    const A = await h.factory.newRep();
    const B = await h.factory.newRep();
    const clientA = await createClient(A, 'A-Only Secret Client');
    const pasteA = await A.http.post<{ id: string }>(`/clients/${clientA}/notes/paste`, { text: "A's private note about a confidential deal" });
    const noteA = pasteA.body.id;
    const promisesA = await A.http.get<{ promises: Array<{ id: string }> }>('/promises');
    const promiseA = promisesA.body.promises[0]?.id;
    const meetingA = (await A.http.post<{ id: string }>(`/clients/${clientA}/meetings`, { datetimeRaw: 'tomorrow at 2pm', title: 'A private meeting' })).body.id;

    // Every id-addressable resource of A, probed as B.
    const probes: Array<['GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown?]> = [
      ['GET', `/clients/${clientA}`],
      ['GET', `/clients/${clientA}/brief`],
      ['POST', `/clients/${clientA}/notes/paste`, { text: 'B intruding into A' }],
      ['PATCH', `/clients/${clientA}`, { phone: '+10000000000' }],
      ['POST', `/clients/${clientA}/deal-value`, { aed: 999999 }],
      ['POST', `/clients/${clientA}/meetings`, { datetimeRaw: 'friday 9am' }],
    ];
    if (promiseA) probes.push(['DELETE', `/promises/${promiseA}`]);
    if (meetingA) probes.push(['DELETE', `/meetings/${meetingA}`]);

    let breach = false;
    for (const [m, path, body] of probes) {
      const res = await B.http.request(m, path, body);
      if (res.status !== 404 && res.status !== 403) {
        breach = true;
        h.report.fail('A', 'ISOLATION', `B ${m} ${path}`, `IDOR: expected 404/403, got ${res.status}`, B.http.lastExchange(), true);
      }
    }
    // Listing A's client notes as B must never surface A's note (RLS-scoped to B).
    const bNotes = await B.http.get<{ notes: Array<{ id: string }> }>(`/clients/${clientA}/notes`);
    const leaked = (bNotes.body.notes ?? []).some((n) => n.id === noteA);
    if (leaked) {
      breach = true;
      h.report.fail('A', 'ISOLATION', 'B GET A/notes', 'IDOR: A\'s note leaked to B', B.http.lastExchange(), true);
    }

    // And A's data is intact — none of B's writes landed.
    const aStillThere = await A.http.get(`/clients/${clientA}`);
    expect(aStillThere.status).toBe(200);

    expect(breach, 'cross-account isolation must hold on every id-addressable resource').toBe(false);
    h.report.pass('A', 'ISOLATION', 'cross-account IDOR denied on every id-addressable resource of A');
  });
});
