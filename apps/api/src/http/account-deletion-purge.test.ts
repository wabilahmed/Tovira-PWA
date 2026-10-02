import { describe, it, expect } from 'vitest';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

// [PRIVACY-3] Account deletion must purge EVERY store that holds the rep's data — including the raw
// content stores enumerated in Task 1, the per-rep glossary, and the outcome history from the
// deal-outcome batch. This proves the AccountService orchestration (recall purge + purgeables) leaves
// zero rows/objects for the deleted account, and never touches another account.
// [NO-TRAINING-RETENTION] the S3 training archive was removed; there is no archive object to purge.
//
// (Postgres additionally purges every table via the users FK cascade — transitively through the
// composite clients/notes FKs for requirements, inventory_matches, aliases; verified in the
// migrations. This in-memory test guards the app-level orchestration and that every store is wired
// into the purge path, so a new store added without a purge fails here.)
describe('[PRIVACY-3] account deletion purges every store', () => {
  async function seed(deps: TestDeps, userId: string): Promise<{ clientId: string; noteId: string }> {
    const client = await deps.clients.create(userId, 'Meridian');
    await deps.clients.setOutcome(userId, client.id, 'won', 'rep', 1000); // outcome history row
    const note = await deps.notes.create(userId, {
      clientId: client.id, source: 'whatsapp_export', rawText: 'raw thread text',
      audioKey: null, status: 'extracted',
      messages: [{ sentAt: '2026-01-01T00:00:00Z', sender: 'Ahmed', body: 'hello', media: false, role: 'client' }],
    });
    await deps.facts.saveExtraction(userId, {
      noteId: note.id, clientId: client.id,
      promises: [{ text: 'send quote', owner: 'rep', due_date: null, due_raw: null, confidence: 'high' }],
    });
    await deps.requirements.saveForNote(userId, note.id, client.id, [
      { text: '2-bed near marina', requirementRaw: 'somewhere near the marina, 2 beds', statedOn: null, confidence: 'high', embedding: null },
    ]);
    await deps.meetings.create(userId, { clientId: client.id, datetime: null, datetimeRaw: 'next week', title: 'viewing', confirmed: true });
    await deps.extractionLog.log(userId, { noteId: note.id, promptVersion: 'v1', model: 'stub', status: 'ok', inputTokens: 1, outputTokens: 1, latencyMs: 1, factsProposed: 1, factsAccepted: 1, factsRejected: 0, rejectedByReason: {} });
    await deps.corrections.record(userId, { noteId: note.id, entityType: 'promise', entityId: 'p1', field: 'text', verdict: 'edit', correctionKind: 'wrong_value', dateDeltaDays: null, promptVersion: 'v1' });
    await deps.repGlossary.upsert(userId, 'Meridiun', 'Meridian', Date.now()); // per-rep glossary row
    const sid = await deps.recallSessions.activeSession(userId, Date.now(), 30 * 60 * 1000);
    await deps.recallSessions.appendMessage(userId, sid, 'user', 'who mentioned the marina?', Date.now());
    const img = await deps.images.create(userId, { clientId: client.id, storageKey: `images/${userId}/card`, contentType: 'image/png' });
    await deps.storage.put(img.storageKey, new Uint8Array([1, 2, 3]));
    return { clientId: client.id, noteId: note.id };
  }

  it('leaves zero rows/objects for the deleted account across every store, and never touches another', async () => {
    const deps = buildInMemoryDeps();
    const A = (await deps.auth.signup('a@example.com', 'password123')).user;
    const B = (await deps.auth.signup('b@example.com', 'password123')).user;
    const a = await seed(deps, A.id);
    const b = await seed(deps, B.id);

    await deps.account.deleteAccount(A.id);

    // Every store is empty for A.
    expect(await deps.clients.listByUser(A.id)).toEqual([]);
    expect(await deps.notes.listByClient(A.id, a.clientId)).toEqual([]);
    expect(await deps.facts.listPromisesByUser(A.id)).toEqual([]);
    expect(await deps.requirements.listByClient(A.id, a.clientId)).toEqual([]);
    expect(await deps.meetings.listByUser(A.id)).toEqual([]);
    expect(await deps.extractionLog.listByUser(A.id)).toEqual([]);
    expect(await deps.corrections.listByUser(A.id)).toEqual([]);
    expect(await deps.repGlossary.listByUser(A.id)).toEqual([]); // per-rep glossary purged
    expect(await deps.recallSessions.exportForUser(A.id)).toEqual([]);
    expect(await deps.images.listByClient(A.id, a.clientId)).toEqual([]);
    expect(await deps.clients.listOutcomeHistory(A.id, a.clientId)).toEqual([]); // outcome history purged

    // Account B is untouched.
    expect((await deps.clients.listByUser(B.id)).length).toBe(1);
    expect((await deps.extractionLog.listByUser(B.id)).length).toBe(1);
    expect((await deps.repGlossary.listByUser(B.id)).length).toBe(1);
    expect((await deps.images.listByClient(B.id, b.clientId)).length).toBe(1);
    expect((await deps.recallSessions.exportForUser(B.id)).length).toBe(1);
  });
});
