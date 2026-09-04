import { describe, it, expect } from 'vitest';
import { NoteMoveService } from './note-move-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryNoteMoveAuditRepository } from '../../adapters/notes/in-memory-note-move-audit-repository.js';
import { InMemoryNoteMoveTx, type MoveStep } from '../../adapters/notes/in-memory-note-move-tx.js';

const USER = 'user-A';

async function fixture(fault?: (step: MoveStep) => void) {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const meetings = new InMemoryMeetingRepository();
  const audit = new InMemoryNoteMoveAuditRepository();
  const tx = new InMemoryNoteMoveTx(notes, facts, meetings, clients, audit, fault);
  const service = new NoteMoveService(notes, facts, meetings, tx);

  const meridian = await clients.create(USER, 'Meridian'); // the WRONG client (misfiled here)
  const ahmed = await clients.create(USER, 'Ahmed'); // the RIGHT client

  // The misfiled note: an import under Meridian, with everything derived.
  const note = await notes.create(USER, {
    clientId: meridian.id,
    source: 'whatsapp_export',
    rawText: 'chat',
    audioKey: null,
    status: 'pending_extraction',
    messages: [
      { sentAt: '2026-03-15T10:00:00Z', sender: 'Ahmed', body: 'hi', media: false, role: 'client' },
      { sentAt: '2026-03-15T10:01:00Z', sender: 'Me', body: 'yo', media: false, role: 'rep' },
    ],
  });
  await notes.update(USER, note.id, {
    status: 'extracted',
    extracted: { summary: '', promises: [], people: [{ name: 'Ahmed' }], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: [{ text: 'A 3-bed', requirement_raw: 'x', stated_on: null, confidence: 'high' }], meeting: null },
  });
  await facts.saveExtraction(USER, {
    noteId: note.id,
    clientId: meridian.id,
    promises: [
      { text: 'Send options', owner: 'rep', due_date: null, due_raw: 'soon', confidence: 'high' },
      { text: 'Call back', owner: 'rep', due_date: null, due_raw: 'later', confidence: 'high' },
    ],
    keyDates: [{ description: 'Viewing', date: null, date_raw: 'next week', type: 'other' }],
  });
  const promises = await facts.listPromisesByNote(USER, note.id);
  await facts.markPromiseDone(USER, promises[0]!.id); // one is DONE — state must survive the move
  await facts.confirmPromise(USER, promises[1]!.id); // one is CONFIRMED — must survive too
  await meetings.create(USER, { clientId: meridian.id, noteId: note.id, datetime: null, datetimeRaw: 'thu', title: null, confirmed: false });

  return { clients, notes, facts, meetings, audit, tx, service, meridian, ahmed, note };
}

describe('[NOTE-MOVE] B3 — move a note and everything derived from it', () => {
  it('previews exactly what will move', async () => {
    const { service, note } = await fixture();
    const p = await service.preview(USER, note.id);
    expect(p).not.toBeNull();
    expect(p!.counts).toEqual({ messages: 2, promises: 2, keyDates: 1, meetings: 1, people: 1, requirements: 1 });
  });

  it('re-points the note, promises, key dates and meeting to the target client', async () => {
    const { service, notes, facts, meetings, ahmed, note } = await fixture();
    const r = await service.move(USER, note.id, ahmed.id);
    expect(r.ok).toBe(true);
    expect((await notes.findByIdForUser(USER, note.id))!.clientId).toBe(ahmed.id);
    for (const p of await facts.listPromisesByNote(USER, note.id)) expect(p.clientId).toBe(ahmed.id);
    for (const d of await facts.listKeyDatesByNote(USER, note.id)) expect(d.clientId).toBe(ahmed.id);
    expect((await meetings.findByNoteId(USER, note.id))!.clientId).toBe(ahmed.id);
  });

  it('preserves promise state (done stays done, confirmed stays confirmed)', async () => {
    const { service, facts, ahmed, note } = await fixture();
    const before = await facts.listPromisesByNote(USER, note.id);
    const doneId = before.find((p) => p.done)!.id;
    const confirmedId = before.find((p) => p.confirmed)!.id;
    await service.move(USER, note.id, ahmed.id);
    const after = await facts.listPromisesByNote(USER, note.id);
    expect(after.find((p) => p.id === doneId)!.done).toBe(true);
    expect(after.find((p) => p.id === confirmedId)!.confirmed).toBe(true);
  });

  it('recomputes last-contact on BOTH clients (the misfile wrongly reset the going-cold clock)', async () => {
    const { service, clients, notes, meridian, ahmed, note } = await fixture();
    // Give Meridian an older, genuine note so its clock should fall back to that after the move.
    const older = await notes.create(USER, { clientId: meridian.id, source: 'voice', rawText: 'real', audioKey: null, status: 'extracted' });
    await service.move(USER, note.id, ahmed.id);
    const from = await clients.findByIdForUser(USER, meridian.id);
    const to = await clients.findByIdForUser(USER, ahmed.id);
    // Meridian's clock now reflects its remaining (older) note, not the moved one.
    expect(from!.lastTouchedAt).toBe(older.createdAt);
    // Ahmed's clock now reflects the moved note.
    expect(to!.lastTouchedAt).toBe(note.createdAt);
  });

  it('clears the move-suggestion and records the move in the audit trail', async () => {
    const { service, notes, audit, meridian, ahmed, note } = await fixture();
    await notes.update(USER, note.id, { moveSuggestion: { toClientId: ahmed.id, toClientName: 'Ahmed', mentioned: ['Ahmed'], reason: 'x', createdAt: 1 } });
    await service.move(USER, note.id, ahmed.id);
    expect((await notes.findByIdForUser(USER, note.id))!.moveSuggestion ?? null).toBeNull();
    const log = await audit.listByUser(USER);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: 'move', fromClientId: meridian.id, toClientId: ahmed.id });
    expect(log[0]!.counts).toEqual({ messages: 2, promises: 2, keyDates: 1, meetings: 1 });
  });

  it('rejects a missing note, a missing target, and a same-client no-op', async () => {
    const { service, meridian, ahmed, note } = await fixture();
    expect(await service.move(USER, 'nope', ahmed.id)).toMatchObject({ ok: false, error: 'note_not_found' });
    expect(await service.move(USER, note.id, 'nope')).toMatchObject({ ok: false, error: 'target_not_found' });
    expect(await service.move(USER, note.id, meridian.id)).toMatchObject({ ok: false, error: 'same_client' });
  });

  // MOVE-ATOMIC (B1): the point of the task — a fault partway through a move leaves NOTHING changed
  // on either client. Inject a throw after the promises are reassigned and assert full rollback.
  it('is atomic: a fault mid-move rolls everything back (nothing changed on either client)', async () => {
    const { service, notes, facts, clients, audit, meridian, ahmed, note } = await fixture((step) => {
      if (step === 'facts') throw new Error('injected fault after promises reassigned');
    });
    const fromLastBefore = (await clients.findByIdForUser(USER, meridian.id))!.lastTouchedAt;
    const toLastBefore = (await clients.findByIdForUser(USER, ahmed.id))!.lastTouchedAt;

    await expect(service.move(USER, note.id, ahmed.id)).rejects.toThrow(/injected fault/);

    // The note, its promises, and both clients' clocks are exactly as before — no partial move.
    expect((await notes.findByIdForUser(USER, note.id))!.clientId).toBe(meridian.id);
    for (const p of await facts.listPromisesByNote(USER, note.id)) expect(p.clientId).toBe(meridian.id);
    for (const d of await facts.listKeyDatesByNote(USER, note.id)) expect(d.clientId).toBe(meridian.id);
    expect((await clients.findByIdForUser(USER, meridian.id))!.lastTouchedAt).toBe(fromLastBefore);
    expect((await clients.findByIdForUser(USER, ahmed.id))!.lastTouchedAt).toBe(toLastBefore);
    // And no audit row was written for a move that did not happen.
    expect(await audit.listByUser(USER)).toHaveLength(0);
  });
});

describe('[IMPORT-UNDO] B4 — undo an import', () => {
  it('removes exactly the note and everything it produced', async () => {
    const { service, notes, facts, meetings, note } = await fixture();
    const r = await service.undo(USER, note.id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.counts).toEqual({ messages: 2, promises: 2, keyDates: 1, meetings: 1 });
    expect(await notes.findByIdForUser(USER, note.id)).toBeNull();
    expect(await facts.listPromisesByNote(USER, note.id)).toHaveLength(0);
    expect(await facts.listKeyDatesByNote(USER, note.id)).toHaveLength(0);
    expect(await meetings.findByNoteId(USER, note.id)).toBeNull();
  });

  it('leaves other notes untouched', async () => {
    const { service, notes, meridian, note } = await fixture();
    const other = await notes.create(USER, { clientId: meridian.id, source: 'voice', rawText: 'keep me', audioKey: null, status: 'extracted' });
    await service.undo(USER, note.id);
    expect(await notes.findByIdForUser(USER, other.id)).not.toBeNull();
  });

  it('is a no-op when the import was already undone (idempotent)', async () => {
    const { service, note } = await fixture();
    await service.undo(USER, note.id);
    expect(await service.undo(USER, note.id)).toMatchObject({ ok: false, error: 'note_not_found' });
  });

  it('recomputes last-contact after the undo', async () => {
    const { service, clients, notes, meridian, note } = await fixture();
    const older = await notes.create(USER, { clientId: meridian.id, source: 'voice', rawText: 'real', audioKey: null, status: 'extracted' });
    await service.undo(USER, note.id);
    expect((await clients.findByIdForUser(USER, meridian.id))!.lastTouchedAt).toBe(older.createdAt);
  });
});
