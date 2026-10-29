import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { InMemoryHotLeadsStore } from './in-memory-hot-leads-store.js';
import { LEAD_STATUSES } from '../../ports/hot-leads.js';

// [P58-3 · owner] The store side of the lead invite: a test lead (marked, never counted), the invite's single token
// (only its hash kept, 14 days), one send and one resend at most (each a conditional write, so two taps can't both
// send), the token used once on submit (the lead becomes Requested), and the token found only while it is live.
const DAY = 86_400_000;
const T0 = Date.parse('2026-10-29T09:00:00Z');
async function lead(s: InMemoryHotLeadsStore) {
  await s.saveBatch([{ personId: 'p1', campaignId: 1, campaignName: 'c', name: 'Sara Khan', email: 'Sara@Example.com', jobTitle: 'Head of leasing', companyName: 'Emaar', companyDomain: null, linkedinUrl: null, country: 'AE', phone: null, whyHot: 'yes please', becameHotAt: T0, erased: false }], T0);
  return (await s.list({}))[0]!;
}

describe('[P58-3] lead invites in the store', () => {
  it('statuses include Requested, between Invited and Signed up', () => {
    expect(LEAD_STATUSES).toEqual(['new', 'contacted', 'invited', 'requested', 'signed_up', 'not_interested']);
  });
  it('a test lead is marked as one', async () => {
    const s = new InMemoryHotLeadsStore();
    const t = await s.createTestLead({ name: 'Wabil Test', email: 'wabil@prospera-technologies.com', companyName: 'Prospera', jobTitle: 'Founder' }, T0);
    expect(t).toMatchObject({ isTest: true, status: 'new', email: 'wabil@prospera-technologies.com', name: 'Wabil Test' });
  });
  it('the first send records the token hash, the time and the 14-day expiry, and the lead becomes Invited; a second send is refused', async () => {
    const s = new InMemoryHotLeadsStore();
    const l = await lead(s);
    const sent = await s.setInvite(l.id, { tokenHash: 'h1', at: T0, expiresAt: T0 + 14 * DAY, resend: false });
    expect(sent).toMatchObject({ status: 'invited', inviteSentAt: T0, inviteExpiresAt: T0 + 14 * DAY, inviteResentAt: null });
    expect(await s.setInvite(l.id, { tokenHash: 'h2', at: T0 + DAY, expiresAt: T0 + 15 * DAY, resend: false })).toBeNull();
  });
  it('a resend only after 3 days, once; it replaces the token', async () => {
    const s = new InMemoryHotLeadsStore();
    const l = await lead(s);
    await s.setInvite(l.id, { tokenHash: 'h1', at: T0, expiresAt: T0 + 14 * DAY, resend: false });
    expect(await s.setInvite(l.id, { tokenHash: 'h2', at: T0 + 3 * DAY - 1, expiresAt: T0 + 17 * DAY, resend: true })).toBeNull(); // too soon
    expect(await s.setInvite(l.id, { tokenHash: 'h2', at: T0 + 3 * DAY, expiresAt: T0 + 17 * DAY, resend: true })).toMatchObject({ inviteResentAt: T0 + 3 * DAY });
    expect(await s.findByInviteToken('h1', T0 + 3 * DAY)).toBeNull(); // the first link no longer works
    expect(await s.findByInviteToken('h2', T0 + 3 * DAY)).toMatchObject({ id: l.id });
    expect(await s.setInvite(l.id, { tokenHash: 'h3', at: T0 + 9 * DAY, expiresAt: T0 + 23 * DAY, resend: true })).toBeNull(); // only once
  });
  it('NEGATIVE: an expired or unknown token finds nothing', async () => {
    const s = new InMemoryHotLeadsStore();
    const l = await lead(s);
    await s.setInvite(l.id, { tokenHash: 'h1', at: T0, expiresAt: T0 + 14 * DAY, resend: false });
    expect(await s.findByInviteToken('h1', T0 + 14 * DAY)).toBeNull();
    expect(await s.findByInviteToken('nope', T0)).toBeNull();
  });
  it('the token is used once: the lead becomes Requested with its request; a second use is refused and the token no longer finds the lead', async () => {
    const s = new InMemoryHotLeadsStore();
    const l = await lead(s);
    await s.setInvite(l.id, { tokenHash: 'h1', at: T0, expiresAt: T0 + 14 * DAY, resend: false });
    expect(await s.markRequested(l.id, 'h1', 'req-1', T0 + DAY)).toMatchObject({ status: 'requested', requestedAt: T0 + DAY, accessRequestId: 'req-1' });
    expect(await s.markRequested(l.id, 'h1', 'req-2', T0 + DAY)).toBeNull();
    expect(await s.findByInviteToken('h1', T0 + DAY)).toBeNull();
  });
  it('the migration adds the status, the test flag and the invite columns, owner pool only (no grant to the app)', () => {
    const sql = readFileSync(new URL('../../../migrations/0107_lead_invite_email.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/'requested'/);
    expect(sql).toMatch(/is_test\s+boolean NOT NULL DEFAULT false/);
    expect(sql).toMatch(/invite_token_hash\s+text/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS hot_leads_invite_token/);
    expect(sql).not.toMatch(/^\s*GRANT\b/im); // no GRANT statement
  });
});
