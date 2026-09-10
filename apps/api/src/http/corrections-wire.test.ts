import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { REJECTED_FIELD, CONFIRMED_FIELD } from '../services/facts/verdict.js';
import { AskCaptureService } from '../services/recall/ask-capture-service.js';
import { InMemoryCorrectionRepository } from '../adapters/corrections/in-memory-correction-repository.js';
import { InMemoryExtractionLogRepository } from '../adapters/logs/in-memory-extraction-log-repository.js';

// [CORRECTIONS-WIRE] Every human verdict — reject, confirm, edit — is recorded as a correction row
// with its ORIGINAL value, across the entity types that HAVE a verdict surface (promise, meeting,
// ask-capture). A verdict write must never break the user action; nothing crosses tenants.

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

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

const lowPromise = { text: 'send the proposal', owner: 'rep' as const, due_date: null, due_raw: 'next week', confidence: 'low' as const };

async function seedPromiseAndGetId(token: string, userId: string, noteId = 'n1'): Promise<string> {
  await deps.facts.saveExtraction(userId, { noteId, clientId: 'c1', promises: [lowPromise] });
  const pending = (await (await fetch(`${base}/confirmations`, { headers: { authorization: `Bearer ${token}` } })).json()) as {
    promises: Array<{ id: string }>;
  };
  return pending.promises[0]!.id;
}

describe('[CORRECTIONS-WIRE] promise verdicts', () => {
  it('REJECT records a rejection correction with the original value, then still deletes the promise', async () => {
    const { token, userId } = await signup('rej-promise@example.com');
    // A logged extraction exists for the note → the correction is stamped with its prompt version.
    await deps.extractionLog.log(userId, {
      noteId: 'n1', promptVersion: 'tovira-extract-vX', model: 'stub', input: 'x', rawOutput: '{}',
      status: 'extracted', inputTokens: 1, outputTokens: 1, latencyMs: 1,
    });
    const id = await seedPromiseAndGetId(token, userId);

    const del = await fetch(`${base}/promises/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    expect(del.status).toBe(200);

    const rows = await deps.corrections.listByUser(userId);
    const rejected = rows.find((r) => r.field === REJECTED_FIELD);
    expect(rejected).toBeTruthy();
    expect(rejected!.entityType).toBe('promise');
    expect(rejected!.after).toBeNull();
    expect(rejected!.before).toContain('send the proposal'); // the ORIGINAL value is retained
    expect(rejected!.promptVersion).toBe('tovira-extract-vX');

    // The fact itself is gone, exactly as before.
    expect(await deps.facts.getPromise(userId, id)).toBeNull();
  });

  it('CONFIRM records a confirmation correction (model was uncertain and right)', async () => {
    const { token, userId } = await signup('conf-promise@example.com');
    const id = await seedPromiseAndGetId(token, userId);

    const conf = await fetch(`${base}/promises/${id}/confirm`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(conf.status).toBe(200);

    const rows = await deps.corrections.listByUser(userId);
    const confirmed = rows.find((r) => r.field === CONFIRMED_FIELD);
    expect(confirmed).toBeTruthy();
    expect(confirmed!.entityType).toBe('promise');
    expect(confirmed!.after).toBe('confirmed');
    expect(confirmed!.before).toContain('send the proposal');
  });

  it('EDIT still records a per-field correction with before/after (regression)', async () => {
    const { token, userId } = await signup('edit-promise@example.com');
    const id = await seedPromiseAndGetId(token, userId);

    const patch = await fetch(`${base}/promises/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'send the REVISED proposal' }),
    });
    expect(patch.status).toBe(200);

    const rows = await deps.corrections.listByUser(userId);
    const edit = rows.find((r) => r.field === 'text');
    expect(edit).toBeTruthy();
    expect(edit!.before).toBe('send the proposal');
    expect(edit!.after).toBe('send the REVISED proposal');
  });

  it('nothing crosses tenants — a reject in tenant A leaves tenant B with no corrections', async () => {
    const a = await signup('tenant-a@example.com');
    const b = await signup('tenant-b@example.com');
    const id = await seedPromiseAndGetId(a.token, a.userId);
    await fetch(`${base}/promises/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${a.token}` } });
    expect(await deps.corrections.listByUser(b.userId)).toEqual([]);
  });
});

describe('[CORRECTIONS-WIRE] isolation — a failing correction write never breaks the action', () => {
  it('a throwing corrections repo does not fail a promise rejection', async () => {
    const d = buildInMemoryDeps();
    // Poison the corrections repo: every record() throws.
    d.corrections.record = async () => { throw new Error('db down'); };
    const srv = createApiServer(d);
    await new Promise<void>((r) => srv.listen(0, r));
    const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${b}/auth/signup`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'iso@example.com', password: 'password123' }),
      });
      const { token, user } = (await res.json()) as { token: string; user: { id: string } };
      await d.facts.saveExtraction(user.id, { noteId: 'n1', clientId: 'c1', promises: [lowPromise] });
      const pending = (await (await fetch(`${b}/confirmations`, { headers: { authorization: `Bearer ${token}` } })).json()) as {
        promises: Array<{ id: string }>;
      };
      const id = pending.promises[0]!.id;
      const del = await fetch(`${b}/promises/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
      expect(del.status).toBe(200); // rejection succeeded despite the correction write throwing
      expect(await d.facts.getPromise(user.id, id)).toBeNull();
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

describe('[CORRECTIONS-WIRE] meeting verdicts (model-proposed only)', () => {
  it('REJECT and CONFIRM of a model-proposed meeting record corrections; a rep-created meeting records none', async () => {
    const { token, userId } = await signup('meet@example.com');
    const client = await deps.clients.create(userId, 'Falcon');
    // Model-proposed (has a source noteId) → verdict recorded.
    const proposed = await deps.meetings.create(userId, {
      clientId: client.id, datetime: null, datetimeRaw: 'next Tuesday', title: null, confirmed: false, noteId: 'n-mtg',
    });
    const confirmRes = await fetch(`${base}/meetings/${proposed.id}/confirm`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(confirmRes.status).toBe(200);

    // Rep-created (noteId null) → no extraction to judge → no verdict.
    const manual = await deps.meetings.create(userId, {
      clientId: client.id, datetime: null, datetimeRaw: 'Friday', title: null, confirmed: true, noteId: null,
    });
    const del = await fetch(`${base}/meetings/${manual.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    expect(del.status).toBe(200);

    const rows = await deps.corrections.listByUser(userId);
    const meetingVerdicts = rows.filter((r) => r.entityType === 'meeting');
    expect(meetingVerdicts).toHaveLength(1); // only the proposed meeting's confirm
    expect(meetingVerdicts[0]!.field).toBe(CONFIRMED_FIELD);
    expect(meetingVerdicts[0]!.entityId).toBe(proposed.id);
  });

  it('REJECT of a model-proposed meeting records a rejection with the original value', async () => {
    const { token, userId } = await signup('meet-rej@example.com');
    const client = await deps.clients.create(userId, 'Delta');
    const proposed = await deps.meetings.create(userId, {
      clientId: client.id, datetime: null, datetimeRaw: 'Thursday 4pm', title: 'demo', confirmed: false, noteId: 'n-mtg2',
    });
    const del = await fetch(`${base}/meetings/${proposed.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    expect(del.status).toBe(200);
    const rows = await deps.corrections.listByUser(userId);
    const rej = rows.find((r) => r.entityType === 'meeting' && r.field === REJECTED_FIELD);
    expect(rej).toBeTruthy();
    expect(rej!.after).toBeNull();
    expect(rej!.before).toContain('Thursday 4pm');
    expect(await deps.meetings.findByIdForUser(userId, proposed.id)).toBeNull(); // still deleted
  });
});

describe('[CORRECTIONS-WIRE] ask-capture rejection is labelled, not merely retained', () => {
  it('reject labels the surviving extraction_logs row and records a rejection correction', async () => {
    const notes = deps.notes;
    const clients = deps.clients;
    const facts = deps.facts;
    const embedder = { embed: async () => [] as number[], dimension: 512 }; // reject() never embeds; a stub suffices
    const corrections = new InMemoryCorrectionRepository();
    const extractionLog = new InMemoryExtractionLogRepository();

    const userId = 'u-ask';
    const client = await clients.create(userId, 'Client Co');
    const note = await notes.create(userId, {
      clientId: client.id, source: 'ask_conversation', rawText: 'I promised them a discount', audioKey: null, status: 'pending_confirmation',
    });
    // The certified (held) extraction logged a row, surviving with status pending_confirmation.
    await extractionLog.log(userId, {
      noteId: note.id, promptVersion: 'tovira-extract-vX', model: 'stub', input: 'I promised them a discount',
      rawOutput: '{"promises":[]}', status: 'pending_confirmation', inputTokens: 5, outputTokens: 5, latencyMs: 3,
    });

    const svc = new AskCaptureService({
      notes, clients, facts, embedder,
      extraction: { extractNote: async () => ({}) },
      corrections, extractionLog,
    });

    const ok = await svc.reject(userId, note.id);
    expect(ok).toBe(true);

    // The surviving log row now reads 'rejected' — a human "no", not an indistinguishable pending row.
    const logs = await extractionLog.listByUser(userId);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe('rejected');

    // And the rejection is recorded as training signal.
    const rows = await corrections.listByUser(userId);
    const rej = rows.find((r) => r.entityType === 'ask_capture' && r.field === REJECTED_FIELD);
    expect(rej).toBeTruthy();
    expect(rej!.before).toContain('I promised them a discount');
    expect(rej!.after).toBeNull();
  });
});
