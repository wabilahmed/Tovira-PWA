import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';

/**
 * [P85-2 · owner, 22 Nov] The data export carries the rep's requirements as their own top-level list (like
 * promises), and keeps the ones a later count replaced, each marked "superseded by <later item, date>". Nothing is
 * dropped from the export; a current need carries no mark. A restricted person's requirement is withheld during an
 * erasure review, like every other fact read from them.
 */
let server: Server; let base: string; let deps: TestDeps;
beforeEach(async () => { deps = buildInMemoryDeps(); server = createApiServer(deps); await listenForTest(server); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });
const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
type Req = { id: string; text: string; clientId: string; supersededBy: { id: string; text: string; date: string } | null; superseded?: string };

async function rep(): Promise<{ token: string; u: string; clientId: string }> {
  const { token, user } = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'exp@x.io', password: 'password123' }) })).json()) as { token: string; user: { id: string } };
  const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Anjali Mehra' }) })).json()) as { id: string }).id;
  return { token, u: user.id, clientId };
}
const row = (text: string, statedOn: string) => ({ text, requirementRaw: text, statedOn, confidence: 'high' as const, embedding: null });
const exportReqs = async (token: string): Promise<Req[]> => ((await (await fetch(`${base}/account/export`, { headers: auth(token) })).json()) as { requirements: Req[] }).requirements;

describe('[P85-2] the export lists requirements and marks the replaced ones', () => {
  it('a replaced count stays in the export, marked "superseded by <later item, date>"; the later one is current', async () => {
    const { token, u, clientId } = await rep();
    await deps.requirements.saveForNote(u, 'n1', clientId, [row('We need at least 3 bedrooms', '2026-03-04')]);
    await deps.requirements.saveForNote(u, 'n2', clientId, [row('So we need 4 bedrooms not 3', '2026-09-12')]);
    const reqs = await exportReqs(token);
    expect(reqs).toHaveLength(2);
    const old = reqs.find((r) => r.text === 'We need at least 3 bedrooms')!;
    const now = reqs.find((r) => r.text === 'So we need 4 bedrooms not 3')!;
    expect(old.supersededBy).toEqual({ id: now.id, text: 'So we need 4 bedrooms not 3', date: '2026-09-12' });
    expect(old.superseded).toBe('superseded by So we need 4 bedrooms not 3, 2026-09-12');
    expect(now.supersededBy).toBeNull();
    expect(now).not.toHaveProperty('superseded');
  });

  it('NEGATIVE: a need that says more than a count is never marked ("3 bedroom villa in Mirdif")', async () => {
    const { token, u, clientId } = await rep();
    await deps.requirements.saveForNote(u, 'n1', clientId, [row('3 bedroom villa in Mirdif', '2026-03-04')]);
    await deps.requirements.saveForNote(u, 'n2', clientId, [row('4 bedrooms', '2026-09-12')]);
    expect((await exportReqs(token)).every((r) => r.supersededBy === null)).toBe(true);
  });

  it('NEGATIVE: another client\'s later count never replaces this client\'s need', async () => {
    const { token, u, clientId } = await rep();
    const other = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Omar Ali' }) })).json()) as { id: string }).id;
    await deps.requirements.saveForNote(u, 'n1', clientId, [row('At least 3 bedrooms', '2026-03-04')]);
    await deps.requirements.saveForNote(u, 'n2', other, [row('4 bedrooms', '2026-09-12')]);
    expect((await exportReqs(token)).every((r) => r.supersededBy === null)).toBe(true);
  });

  it('NEGATIVE: during an erasure review a requirement read from the restricted person is withheld; the others stay', async () => {
    const { token, u, clientId } = await rep();
    const K = 'ZEBRAQUARTZ we need at least 3 bedrooms';
    const note = await deps.notes.create(u, { clientId, source: 'whatsapp_export', rawText: `Khalid: ${K}\nOmar: a garden please`, audioKey: null, status: 'extracted',
      messages: [{ sentAt: '2026-03-04T10:00', sender: 'Khalid', body: K, media: false, role: 'client' }, { sentAt: '2026-03-04T10:01', sender: 'Omar', body: 'a garden please', media: false, role: 'client' }] } as never);
    await deps.requirements.saveForNote(u, note.id, clientId, [{ ...row('At least 3 bedrooms', '2026-03-04'), requirementRaw: K }, row('A garden', '2026-03-04')]);
    await deps.erasureRequests.create(u, { requesterNames: ['Khalid'], requestedAt: Date.now(), windowEndsAt: Date.now() + 10 * 86_400_000 });
    const texts = (await exportReqs(token)).map((r) => r.text);
    expect(texts).toEqual(['A garden']);
  });

  it('NEGATIVE: an export with no requirements has an empty list, never a missing one', async () => {
    const { token } = await rep();
    expect(await exportReqs(token)).toEqual([]);
  });
});
