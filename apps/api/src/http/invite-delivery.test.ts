import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { signInAdmin } from '../test-support/admin-session.js';
import { listenForTest } from '../test-support/listen.js';
import type { HotLeadInput } from '../ports/hot-leads.js';
import { deliveryStatusOf, nextDelivery, verifySvix } from '../services/leads/resend-webhook.js';
import { ResendEmailSender } from '../adapters/email/resend-email-sender.js';

// [P63-9 · owner] Each lead card shows the invite email's delivery: delivered, bounced or marked spam, from Resend's
// delivery webhooks (signed). Never opens or clicks. Shipped dark: without the signing secret the webhook is refused and
// nothing is recorded, and the card says delivery status isn't connected yet.
const SECRET = `whsec_${Buffer.from('a-test-signing-secret-32-bytes!!').toString('base64')}`;
const LEAD: HotLeadInput = { personId: 'p1', campaignId: 7, campaignName: 'Dubai brokers', name: 'Sara Khan', email: 'sara@emaar.example', jobTitle: 'Head of Leasing', companyName: 'Emaar', companyDomain: null, linkedinUrl: null, country: 'AE', phone: null, whyHot: 'Yes', becameHotAt: Date.now(), erased: false };
const JSONH = { 'content-type': 'application/json' };
function signed(body: unknown, secret = SECRET, at = Date.now()): { headers: Record<string, string>; body: string } {
  const raw = JSON.stringify(body);
  const id = `msg_${Math.random().toString(36).slice(2)}`;
  const ts = String(Math.floor(at / 1000));
  const sig = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${ts}.${raw}`).digest('base64');
  return { headers: { ...JSONH, 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` }, body: raw };
}

let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
async function start(secret?: string): Promise<{ url: string; deps: TestDeps; leadId: string; cookie: string }> {
  const deps = buildInMemoryDeps();
  deps.resendWebhookSecret = secret;
  server = createApiServer(deps);
  const url = await listenForTest(server!);
  const [lead] = await deps.hotLeads.saveBatch([LEAD], Date.now());
  const { cookie } = await signInAdmin(url, deps);
  await fetch(`${url}/admin/leads/${lead!.id}/invite-email`, { method: 'POST', headers: { ...JSONH, cookie }, body: '{}' });
  return { url, deps, leadId: lead!.id, cookie };
}
const hook = (url: string, s: { headers: Record<string, string>; body: string }) => fetch(`${url}/webhooks/resend`, { method: 'POST', headers: s.headers, body: s.body });
const event = (type: string, leadId: string) => ({ type, created_at: new Date().toISOString(), data: { email_id: 'e1', to: ['sara@emaar.example'], subject: 'x', tags: { lead: leadId } } });

describe('[P63-9] delivery statuses', () => {
  it('map: delivered, bounced, complained (marked spam); opened and clicked are never recorded', () => {
    expect(deliveryStatusOf('email.delivered')).toBe('delivered');
    expect(deliveryStatusOf('email.bounced')).toBe('bounced');
    expect(deliveryStatusOf('email.complained')).toBe('complained');
    for (const t of ['email.opened', 'email.clicked', 'email.sent', 'email.delivery_delayed']) expect(deliveryStatusOf(t)).toBeNull();
  });
  it('NEGATIVE: a bounce or a spam mark is never replaced by a later delivered', () => {
    expect(nextDelivery('bounced', 'delivered')).toBe('bounced');
    expect(nextDelivery('complained', 'delivered')).toBe('complained');
    expect(nextDelivery('delivered', 'complained')).toBe('complained');
    expect(nextDelivery(null, 'delivered')).toBe('delivered');
  });
  it('NEGATIVE: a signature that is wrong, missing or too old is refused', () => {
    const s = signed({ a: 1 });
    const hd = { id: s.headers['svix-id'], timestamp: s.headers['svix-timestamp'], signature: s.headers['svix-signature'] };
    expect(verifySvix(SECRET, hd, s.body, Date.now())).toBe(true);
    expect(verifySvix(SECRET, hd, `${s.body} `, Date.now())).toBe(false);
    expect(verifySvix(SECRET, { ...hd, signature: undefined }, s.body, Date.now())).toBe(false);
    expect(verifySvix(SECRET, hd, s.body, Date.now() + 10 * 60_000)).toBe(false);
  });
});

describe('[P63-9] POST /webhooks/resend', () => {
  it('the invite email is sent tagged with its lead (no personal data in the tag)', async () => {
    const { deps, leadId } = await start(SECRET);
    expect(deps.emailSender.sent.find((m) => m.to === 'sara@emaar.example')!.tags).toEqual({ lead: leadId });
  });
  it('a signed delivered event shows on the lead; a later bounce replaces it', async () => {
    const { url, deps, leadId, cookie } = await start(SECRET);
    expect((await hook(url, signed(event('email.delivered', leadId)))).status).toBe(200);
    expect((await deps.hotLeads.get(leadId))!.inviteDelivery).toBe('delivered');
    await hook(url, signed(event('email.bounced', leadId)));
    expect((await deps.hotLeads.get(leadId))!.inviteDelivery).toBe('bounced');
    const view = (await (await fetch(`${url}/admin/leads`, { headers: { cookie } })).json()) as { leads: Array<{ id: string; inviteDelivery: string }>; deliveryConnected: boolean };
    expect(view.deliveryConnected).toBe(true);
    expect(view.leads.find((l) => l.id === leadId)!.inviteDelivery).toBe('bounced');
  });
  it('NEGATIVE: opened and clicked events record nothing', async () => {
    const { url, deps, leadId } = await start(SECRET);
    expect((await hook(url, signed(event('email.opened', leadId)))).status).toBe(200);
    await hook(url, signed(event('email.clicked', leadId)));
    expect((await deps.hotLeads.get(leadId))!.inviteDelivery ?? null).toBeNull();
  });
  it('NEGATIVE: a forged event (wrong secret) is refused and records nothing', async () => {
    const { url, deps, leadId } = await start(SECRET);
    const forged = signed(event('email.complained', leadId), `whsec_${Buffer.from('another-secret-another-secret-!!').toString('base64')}`);
    expect((await hook(url, forged)).status).toBe(401);
    expect((await deps.hotLeads.get(leadId))!.inviteDelivery ?? null).toBeNull();
  });
  it('NEGATIVE: shipped dark: without the signing secret every call is refused, nothing is recorded, and the card says it is not connected', async () => {
    const { url, deps, leadId, cookie } = await start(undefined);
    expect((await hook(url, signed(event('email.delivered', leadId)))).status).toBe(503);
    expect((await deps.hotLeads.get(leadId))!.inviteDelivery ?? null).toBeNull();
    const view = (await (await fetch(`${url}/admin/leads`, { headers: { cookie } })).json()) as { deliveryConnected: boolean };
    expect(view.deliveryConnected).toBe(false);
  });
  it('NEGATIVE: this push reads no new secret (key-first): RESEND_WEBHOOK_SECRET is not read by the API yet', () => {
    const cfg = readFileSync(new URL('../config.ts', import.meta.url), 'utf8');
    expect(cfg).not.toMatch(/RESEND_WEBHOOK_SECRET/);
  });
  it('a re-sent invite clears the old status', async () => {
    const { url, deps, leadId } = await start(SECRET);
    await hook(url, signed(event('email.bounced', leadId)));
    await deps.hotLeads.setInvite(leadId, { tokenHash: 'h2', at: Date.now() + 4 * 86_400_000, expiresAt: Date.now() + 18 * 86_400_000, resend: true });
    expect((await deps.hotLeads.get(leadId))!.inviteDelivery ?? null).toBeNull();
  });
});

describe('[P63-9] Resend gets the tags', () => {
  it('sends a message\'s tags as Resend tags', async () => {
    const calls: Array<{ body: string }> = [];
    const fetchImpl = (async (_u: string, init: { body: string }) => { calls.push(init); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    await new ResendEmailSender({ apiKey: 'k', from: 'Tovira <hello@tovira.io>', fetchImpl }).send({ to: 'a@example.com', subject: 's', text: 't', tags: { lead: 'abc-123' } });
    expect(JSON.parse(calls[0]!.body).tags).toEqual([{ name: 'lead', value: 'abc-123' }]);
  });
});
