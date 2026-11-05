import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { signInAdmin } from '../test-support/admin-session.js';
import type { HotLeadInput } from '../ports/hot-leads.js';
import { listenForTest } from '../test-support/listen.js';

// [P63-5 · owner] "Invite link opened" was never recorded. From this deploy: the first time the invite link's form loads
// with its live token, the lead's invite_opened_at is set, once. Re-opening keeps the first time; an unknown or expired
// token records nothing.
let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
const DAY = 86_400_000;
const LEAD: HotLeadInput = { personId: 'p1', campaignId: 7, campaignName: 'Dubai brokers', name: 'Sara Khan', email: 'sara@emaar.example', jobTitle: 'Head of Leasing', companyName: 'Emaar', companyDomain: 'emaar.example', linkedinUrl: null, country: 'AE', phone: null, whyHot: 'Yes', becameHotAt: Date.now() - 3_600_000, erased: false };
const JSONH = { 'content-type': 'application/json' };

async function invited(): Promise<{ base: string; deps: TestDeps; leadId: string; token: string }> {
  const deps = buildInMemoryDeps();
  server = createApiServer(deps);
  const base = await listenForTest(server!);
  const [lead] = await deps.hotLeads.saveBatch([LEAD], Date.now());
  const { cookie } = await signInAdmin(base, deps);
  await fetch(`${base}/admin/leads/${lead!.id}/invite-email`, { method: 'POST', headers: { ...JSONH, cookie }, body: '{}' });
  const token = /request-access\?invite=([A-Za-z0-9_-]+)/.exec(deps.emailSender.sent.filter((m) => m.to === 'sara@emaar.example').at(-1)!.text)![1]!;
  return { base, deps, leadId: lead!.id, token };
}
const prefill = (base: string, token: string) => fetch(`${base}/access-request/invite`, { method: 'POST', headers: JSONH, body: JSON.stringify({ token }) });

describe('[P63-5] invite link opened', () => {
  it('the first load of the form with the live token records when it was opened', async () => {
    const { base, deps, leadId, token } = await invited();
    expect((await deps.hotLeads.get(leadId))!.inviteOpenedAt ?? null).toBeNull();
    expect((await prefill(base, token)).status).toBe(200);
    const opened = (await deps.hotLeads.get(leadId))!.inviteOpenedAt;
    expect(typeof opened).toBe('number');
    expect(Math.abs(opened! - Date.now())).toBeLessThan(5_000);
  });
  it('NEGATIVE: opening again keeps the first time (recorded once)', async () => {
    const { base, deps, leadId, token } = await invited();
    await prefill(base, token);
    const first = (await deps.hotLeads.get(leadId))!.inviteOpenedAt;
    deps.leadInviteClock.offsetMs = DAY;
    await prefill(base, token);
    expect((await deps.hotLeads.get(leadId))!.inviteOpenedAt).toBe(first);
  });
  it('NEGATIVE: an unknown or expired token records nothing', async () => {
    const { base, deps, leadId, token } = await invited();
    await prefill(base, 'x'.repeat(43));
    expect((await deps.hotLeads.get(leadId))!.inviteOpenedAt ?? null).toBeNull();
    deps.leadInviteClock.offsetMs = 14 * DAY;
    await prefill(base, token);
    expect((await deps.hotLeads.get(leadId))!.inviteOpenedAt ?? null).toBeNull();
  });
  it('the migration adds the column, and the pg store reads and sets it once', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../../migrations/0111_invite_opened.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS invite_opened_at\s+timestamptz/);
    const pg = readFileSync(new URL('../adapters/leads/pg-hot-leads-store.ts', import.meta.url), 'utf8');
    expect(pg).toMatch(/SET invite_opened_at = \$2::timestamptz[^`]*WHERE id = \$1 AND invite_opened_at IS NULL/);
  });
});
