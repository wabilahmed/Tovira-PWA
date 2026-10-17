import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

let server: Server;
let base: string;
let deps: TestDeps;

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function signup(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  return ((await res.json()) as { token: string }).token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function client(t: string, name: string): Promise<string> {
  return ((await (await fetch(`${base}/clients`, { method: 'POST', headers: auth(t), body: JSON.stringify({ name }) })).json()) as { id: string }).id;
}
async function paste(t: string, clientId: string, text: string): Promise<void> {
  await fetch(`${base}/clients/${clientId}/notes/paste`, { method: 'POST', headers: auth(t), body: JSON.stringify({ text }) });
}

describe('[P5-3] onboarding status', () => {
  it('nudges toward the first value moment as the rep seeds data', async () => {
    const token = await signup('onboard@example.com');
    let s = (await (await fetch(`${base}/onboarding/status`, { headers: auth(token) })).json()) as { hasClient: boolean; briefReachable: boolean; nextStep: string };
    expect(s.hasClient).toBe(false);
    expect(s.nextStep).toMatch(/first client/i);
    const c = await client(token, 'Meridian');
    await paste(token, c, 'some real history to work with');
    s = (await (await fetch(`${base}/onboarding/status`, { headers: auth(token) })).json()) as { hasClient: boolean; briefReachable: boolean; nextStep: string };
    expect(s.briefReachable).toBe(true);
    expect(s.nextStep).toMatch(/brief/i);
  });
});

describe('[P5-4] data trust & control', () => {
  it('exports the rep\'s data', async () => {
    const token = await signup('export@example.com');
    const c = await client(token, 'Export Corp');
    await paste(token, c, 'exported note content');
    const data = (await (await fetch(`${base}/account/export`, { headers: auth(token) })).json()) as { clients: unknown[]; notes: Array<{ rawText: string }>; images: unknown[]; promises: unknown[]; keyDates: unknown[]; meetings: unknown[] };
    expect(data.clients).toHaveLength(1);
    expect(data.notes.some((n) => n.rawText.includes('exported note'))).toBe(true);
    // P5-4 full corpus: the export carries every section, including images.
    expect(Array.isArray(data.images)).toBe(true);
    expect(Array.isArray(data.promises)).toBe(true);
    expect(Array.isArray(data.keyDates)).toBe(true);
    expect(Array.isArray(data.meetings)).toBe(true);
  });

  // [P20-2 / BOOK-09] A soft-deleted promise leaves every surface but still travels in the DSAR export,
  // with its deleted_at, so the rep's export is complete.
  it('[P20-2] carries a soft-deleted promise in the export, with deletedAt', async () => {
    const res = await fetch(`${base}/auth/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'export-softdel@example.com', password: 'password123' }),
    });
    const { token, user } = (await res.json()) as { token: string; user: { id: string } };
    await deps.facts.saveExtraction(user.id, { noteId: 'n1', clientId: 'c1', promises: [{ text: 'send plan', owner: 'rep', due_date: '2026-08-01', due_raw: null, confidence: 'high' }] });
    const id = (await deps.facts.listPromisesByUser(user.id))[0]!.id;
    await deps.facts.softDeletePromise(user.id, id, Date.now());
    const data = (await (await fetch(`${base}/account/export`, { headers: auth(token) })).json()) as { promises: Array<{ id: string; deletedAt: number | null }> };
    const exported = data.promises.find((p) => p.id === id);
    expect(exported).toBeTruthy();
    expect(exported!.deletedAt).not.toBeNull();
  });

  // [P18-10j] The rep's inventory is their own data — it must travel in the DSAR export (was missing).
  it('[P18-10j] carries the rep\'s inventory in the export', async () => {
    const res = await fetch(`${base}/auth/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'export-inventory@example.com', password: 'password123' }),
    });
    const { token, user } = (await res.json()) as { token: string; user: { id: string } };
    await deps.inventoryRepo.create(user.id, { title: 'Marina 2-bed', description: 'sea view', quantity: 1, embedding: null });
    const data = (await (await fetch(`${base}/account/export`, { headers: auth(token) })).json()) as { inventory: Array<{ title: string }> };
    expect(Array.isArray(data.inventory)).toBe(true);
    expect(data.inventory.some((i) => i.title === 'Marina 2-bed')).toBe(true);
  });

  // [LEAD-STATUS] A rep's manual pipeline label is their own data — it must travel in the DSAR export.
  it('carries each client\'s lead_status in the export', async () => {
    const token = await signup('export-lead@example.com');
    const c = await client(token, 'Pipeline Corp');
    await fetch(`${base}/clients/${c}/lead-status`, { method: 'POST', headers: auth(token), body: JSON.stringify({ status: 'warm' }) });
    const data = (await (await fetch(`${base}/account/export`, { headers: auth(token) })).json()) as {
      clients: Array<{ id: string; leadStatus: string | null; leadStatusChangedAt: number | null }>;
    };
    const exported = data.clients.find((x) => x.id === c)!;
    expect(exported.leadStatus).toBe('warm');
    expect(exported.leadStatusChangedAt).toBeGreaterThan(0);
  });

  // [NO-TRAINING-RETENTION] The export must still carry the rep's extraction metadata, verdicts, and
  // per-rep glossary — their own data in a DSAR context — but these now hold NO conversation content.
  it('exports the extraction log, rep verdicts, and per-rep glossary (metadata only)', async () => {
    const res = await fetch(`${base}/auth/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'export-training@example.com', password: 'password123' }),
    });
    const { token, user } = (await res.json()) as { token: string; user: { id: string } };
    // Seed one extraction-log row + one verdict + one glossary term for this rep.
    await deps.extractionLog.log(user.id, {
      noteId: 'n-exp', promptVersion: 'tovira-extract-vX', model: 'stub',
      status: 'extracted', inputTokens: 3, outputTokens: 3, latencyMs: 2,
      factsProposed: 1, factsAccepted: 1, factsRejected: 0, rejectedByReason: {},
    });
    await deps.corrections.record(user.id, {
      noteId: 'n-exp', entityType: 'promise', entityId: 'p1', field: 'text',
      verdict: 'edit', correctionKind: 'wrong_value', dateDeltaDays: null, promptVersion: 'tovira-extract-vX',
    });
    await deps.repGlossary.upsert(user.id, 'Meridiun', 'Meridian', Date.now());

    const data = (await (await fetch(`${base}/account/export`, { headers: auth(token) })).json()) as {
      extractionLogs: Array<Record<string, unknown>>;
      corrections: Array<Record<string, unknown>>;
      repGlossary: Array<{ wrongTerm: string; rightTerm: string }>;
    };
    expect(Array.isArray(data.extractionLogs)).toBe(true);
    expect(data.extractionLogs).toHaveLength(1);
    expect(data.extractionLogs[0]).not.toHaveProperty('input');
    expect(data.extractionLogs[0]).not.toHaveProperty('rawOutput');
    expect(Array.isArray(data.corrections)).toBe(true);
    expect(data.corrections).toHaveLength(1);
    expect(data.corrections[0]).not.toHaveProperty('before');
    expect(data.corrections[0]).not.toHaveProperty('after');
    expect(data.corrections[0]!.verdict).toBe('edit');
    expect(Array.isArray(data.repGlossary)).toBe(true);
    expect(data.repGlossary.some((r) => r.wrongTerm === 'Meridiun' && r.rightTerm === 'Meridian')).toBe(true);
  });

  // NEGATIVE: after delete, the data does not reappear.
  it('deletes the account and its data so nothing reappears', async () => {
    const token = await signup('delete@example.com');
    const c = await client(token, 'Delete Corp');
    await paste(token, c, 'secret note');
    expect((await fetch(`${base}/account`, { method: 'DELETE', headers: auth(token) })).status).toBe(200);
    // The account is gone (protected identity route 401) and its clients are purged.
    expect((await fetch(`${base}/me`, { headers: auth(token) })).status).toBe(401);
    const list = (await (await fetch(`${base}/clients`, { headers: auth(token) })).json()) as { clients: unknown[] };
    expect(list.clients).toEqual([]);
  });

  it('requires auth for export and delete', async () => {
    expect((await fetch(`${base}/account/export`)).status).toBe(401);
    expect((await fetch(`${base}/account`, { method: 'DELETE' })).status).toBe(401);
  });
});
