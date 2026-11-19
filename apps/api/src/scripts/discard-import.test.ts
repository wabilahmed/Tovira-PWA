import { describe, it, expect } from 'vitest';
import { parseDiscardArgs, runDiscardImport, type DiscardDeps, type NoteInfo } from './discard-import.js';

/**
 * [P79-EMERGENCY · owner] Discard one import completely (a 28,357-message test chat parked by the AI pause): the note
 * and its facts through the import-undo path, its client when nothing else is in it, and the staged WhatsApp batch,
 * so nothing for it can restart. Dry run by default; the check (note, batch files, queued notes over the limit) is
 * printed before and after.
 */
const U = '11111111-1111-4111-8111-111111111111';
const N = '22222222-2222-4222-8222-222222222222';
const B = 'wa-9076d719-0491-46cb-b870-6527649dcb3c';

function world(o: { note?: Partial<NoteInfo> | null; otherNotes?: number; batch?: number; queuedExtra?: number } = {}) {
  let note: NoteInfo | null = o.note === null ? null : { status: 'needs_review', source: 'whatsapp_export', clientId: 'c1', messages: 28_357, attempts: 5, claimedAt: null, ...(o.note ?? {}) };
  let clientExists = true;
  let keys = Array.from({ length: o.batch ?? 2 }, (_, i) => `bulk-import/${U}/${B}/f${i}.json`);
  const other = Array.from({ length: o.queuedExtra ?? 0 }, (_, i) => ({ id: `q${i}`, status: 'pending_extraction', messages: 40 }));
  const calls: string[] = [];
  const d: DiscardDeps = {
    note: async () => note,
    queued: async () => [...(note && note.status !== 'needs_review' ? [{ id: N, status: note.status, messages: note.messages }] : []), ...other],
    clientNotes: async () => (note ? 1 : 0) + (o.otherNotes ?? 0),
    undo: async () => { calls.push('undo'); note = null; return { ok: true }; },
    deleteClientIfEmpty: async () => { calls.push('client'); if ((o.otherNotes ?? 0) > 0 || note) return false; clientExists = false; return true; },
    batchKeys: async () => keys,
    deleteKey: async (k) => { calls.push('key'); keys = keys.filter((x) => x !== k); },
  };
  return { d, calls, state: () => ({ note, clientExists, keys }) };
}
const args = (apply = false) => parseDiscardArgs(['--only-user', U, '--ids', `${N},${B}`, ...(apply ? ['--apply'] : [])]);

describe('[P79-EMERGENCY] discard-import arguments', () => {
  it('needs the rep, then the note id and the batch id; anything else is refused', () => {
    expect(args()).toEqual({ userId: U, noteId: N, batchId: B, apply: false });
    expect(() => parseDiscardArgs(['--ids', `${N},${B}`])).toThrow(/--only-user/);
    expect(() => parseDiscardArgs(['--only-user', U, '--ids', N])).toThrow(/--ids/);
    expect(() => parseDiscardArgs(['--only-user', U, '--ids', `${B},${N}`])).toThrow(/note id/);
    expect(() => parseDiscardArgs(['--only-user', U, '--ids', `${N},bad id!`])).toThrow(/batch id/);
    expect(() => parseDiscardArgs(['--only-user', U, '--ids', `${N},${B}`, '--force'])).toThrow(/unknown argument/);
  });
});

describe('[P79-EMERGENCY] discard-import', () => {
  it('the dry run changes nothing and shows the check', async () => {
    const w = world({ note: { status: 'pending_extraction' } });
    const r = await runDiscardImport(w.d, args());
    expect(w.calls).toEqual([]);
    expect(r.after).toBeNull();
    expect(r.before).toMatchObject({ note: { messages: 28_357 }, batchFiles: 2, queuedOverLimit: 1 });
  });
  it('apply: the note (undo), its now-empty client and the staged batch go; the check after is clean', async () => {
    const w = world({ note: { status: 'pending_extraction' } });
    const r = await runDiscardImport(w.d, args(true));
    expect(w.calls).toEqual(['undo', 'client', 'key', 'key']);
    expect(w.state()).toEqual({ note: null, clientExists: false, keys: [] });
    expect(r.after).toMatchObject({ note: null, batchFiles: 0, queuedOverLimit: 0 });
  });
  it('a client with other notes is kept', async () => {
    const w = world({ otherNotes: 3 });
    const r = await runDiscardImport(w.d, args(true));
    expect(w.state().clientExists).toBe(true);
    expect(r.actions).toContain('client kept (it has other notes)');
  });
  it("the rep's other queued notes are listed and left alone", async () => {
    const w = world({ queuedExtra: 2 });
    const r = await runDiscardImport(w.d, args(true));
    expect(r.after!.queued.map((q) => q.id)).toEqual(['q0', 'q1']);
    expect(r.after!.queuedOverLimit).toBe(0);
  });
  it('the note already gone: only the batch is removed', async () => {
    const w = world({ note: null });
    const r = await runDiscardImport(w.d, args(true));
    expect(w.calls).toEqual(['key', 'key']);
    expect(r.after).toMatchObject({ note: null, batchFiles: 0 });
  });
  it('NEGATIVE: a note that is not an import is never touched', async () => {
    const w = world({ note: { source: 'voice' } });
    await expect(runDiscardImport(w.d, args(true))).rejects.toThrow(/not an import/);
    expect(w.calls).toEqual([]);
  });
  it('NEGATIVE: wrong ids (nothing found for this rep): refused, nothing changed', async () => {
    const w = world({ note: null, batch: 0 });
    await expect(runDiscardImport(w.d, args(true))).rejects.toThrow(/nothing to discard/);
    expect(w.calls).toEqual([]);
  });
  it('NEGATIVE: if the undo fails, the batch is not touched', async () => {
    const w = world();
    w.d.undo = async () => ({ ok: false, error: 'note_not_found' });
    await expect(runDiscardImport(w.d, args(true))).rejects.toThrow(/could not be removed/);
    expect(w.state().keys).toHaveLength(2);
  });
});
