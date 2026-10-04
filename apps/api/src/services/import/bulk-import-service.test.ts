import { describe, it, expect, vi } from 'vitest';
import { BulkImportService } from './bulk-import-service.js';
import { parseWhatsAppExport } from './whatsapp.js';
import type { ClientRecord, ClientRepository } from '../../ports/client-repository.js';
import type { NoteRecord, NoteRepository, NewNote, ImportedMessage } from '../../ports/note-repository.js';
import type { ExtractOutcome } from '../extraction/extraction-service.js';

// Tiny in-memory repos — only the methods the service touches.
const clientRecord = (id: string, userId: string, name: string, phone: string | null = null): ClientRecord =>
  ({ id, userId, name, phone, title: null, email: null, createdAt: 0 } as unknown as ClientRecord);

function fakeClients(seed: ClientRecord[] = []): ClientRepository & { all: ClientRecord[] } {
  const all = [...seed];
  return {
    all,
    listByUser: async (uid: string) => all.filter((c) => c.userId === uid),
    create: async (uid: string, name: string, phone: string | null = null) => {
      const c = clientRecord(`c${all.length + 1}`, uid, name, phone);
      all.push(c);
      return c;
    },
    touch: async () => {},
  } as unknown as ClientRepository & { all: ClientRecord[] };
}
function fakeNotes(): NoteRepository & { all: NoteRecord[] } {
  const all: NoteRecord[] = [];
  return {
    all,
    listByClient: async (uid: string, cid: string) => all.filter((n) => n.userId === uid && n.clientId === cid),
    create: async (uid: string, note: NewNote) => {
      const n = { id: `n${all.length + 1}`, userId: uid, createdAt: 0, ...note } as unknown as NoteRecord;
      all.push(n);
      return n;
    },
  } as unknown as NoteRepository & { all: NoteRecord[] };
}

const androidChat = (rep: string, other: string) =>
  [`13/07/2019, 1:00 am - ${rep}: hi`, `13/07/2019, 1:01 am - ${other}: hello, about the Marina quote`].join('\n');

function makeService(over: Partial<ConstructorParameters<typeof BulkImportService>[0]> = {}) {
  const clients = over.clients ?? fakeClients();
  const notes = over.notes ?? fakeNotes();
  const extract = over.extract ?? vi.fn(async (): Promise<ExtractOutcome> => ({ status: 'extracted' }));
  const svc = new BulkImportService({
    clients, notes, extract,
    isExhausted: over.isExhausted ?? (async () => false),
    isPaused: over.isPaused,
    concurrency: over.concurrency ?? 4,
    allowanceAed: over.allowanceAed ?? 45,
    modelId: over.modelId ?? 'claude-sonnet-5',
    repNames: over.repNames,
  });
  return { svc, clients: clients as ClientRepository & { all: ClientRecord[] }, notes: notes as NoteRepository & { all: NoteRecord[] }, extract };
}

describe('[BULK-IMPORT] BulkImportService', () => {
  it('parse returns a per-file result plus the up-front estimate as a % of the allowance', async () => {
    const { svc } = makeService();
    const out = await svc.parse('u', [
      { name: 'a.txt', content: androidChat('Wabil', 'Layla') },
      { name: 'b.txt', content: androidChat('Wabil', 'Omar') },
    ], 'Wabil');
    expect(out.result.rows).toHaveLength(2);
    expect(out.estimateAed).toBeGreaterThan(0);
    expect(out.percentOfAllowance).toBeGreaterThan(0);
  });

  it('a "new" decision creates a client and a pending_extraction note, then extracts it once', async () => {
    const { svc, clients, notes, extract } = makeService();
    const files = [{ name: 'a.txt', content: androidChat('Wabil', 'Layla') }];
    const res = await svc.importConfirmed('u', files, [{ fileName: 'a.txt', action: 'new', name: 'Layla' }], '2026-10-04');
    expect(clients.all).toHaveLength(1);
    expect(clients.all[0]!.name).toBe('Layla');
    expect(notes.all).toHaveLength(1);
    expect(notes.all[0]!.status).toBe('pending_extraction');
    expect(notes.all[0]!.source).toBe('whatsapp_export');
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledWith('u', notes.all[0]!.id, '2026-10-04');
    expect(res.jobs).toEqual([{ key: 'a.txt', noteId: notes.all[0]!.id, state: 'done' }]);
    expect(res.created).toBe(1);
    // the pipeline ran: the counterpart's messages are tagged as the client
    expect(notes.all[0]!.messages!.some((m) => m.role === 'client')).toBe(true);
  });

  it('RULING 2: when the allowance is exhausted, nothing is started — no client, no note, content discarded', async () => {
    const { svc, clients, notes, extract } = makeService({ isExhausted: async () => true });
    const res = await svc.importConfirmed('u', [
      { name: 'a.txt', content: androidChat('Wabil', 'Layla') },
      { name: 'b.txt', content: androidChat('Wabil', 'Omar') },
    ], [
      { fileName: 'a.txt', action: 'new', name: 'Layla' },
      { fileName: 'b.txt', action: 'new', name: 'Omar' },
    ], '2026-10-04');
    expect(res.jobs.every((j) => j.state === 'failed_usage_limit')).toBe(true);
    expect(res.created).toBe(0);
    expect(clients.all).toHaveLength(0); // no client created for a discarded chat
    expect(notes.all).toHaveLength(0); // content not stored
    expect(extract).not.toHaveBeenCalled();
  });

  it('a "merge" decision files under the existing client and creates NO new client', async () => {
    const seed: ClientRecord[] = [clientRecord('cX', 'u', 'Ahmed')];
    const { svc, clients, notes } = makeService({ clients: fakeClients(seed) });
    await svc.importConfirmed('u', [{ name: 'a.txt', content: androidChat('Wabil', 'Ahmed') }], [{ fileName: 'a.txt', action: 'merge', clientId: 'cX' }], '2026-10-04');
    expect(clients.all).toHaveLength(1); // no new client
    expect(notes.all[0]!.clientId).toBe('cX');
  });

  it('extracts every chat in its OWN call — one call per created note (D1)', async () => {
    const { svc, extract, notes } = makeService();
    await svc.importConfirmed('u', [
      { name: 'a.txt', content: androidChat('Wabil', 'Layla') },
      { name: 'b.txt', content: androidChat('Wabil', 'Omar') },
      { name: 'c.txt', content: androidChat('Wabil', 'Sara') },
    ], [
      { fileName: 'a.txt', action: 'new', name: 'Layla' },
      { fileName: 'b.txt', action: 'new', name: 'Omar' },
      { fileName: 'c.txt', action: 'new', name: 'Sara' },
    ], '2026-10-04');
    expect(extract).toHaveBeenCalledTimes(3);
    const calledNoteIds = (extract as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]).sort();
    expect(calledNoteIds).toEqual(notes.all.map((n) => n.id).sort());
  });

  // --- RULING 2 item 4: existing clients are added to, not duplicated ---
  const chatFrom = (pairs: Array<[string, string]>) =>
    pairs.map(([s, b], i) => `13/07/2019, 1:${String(i).padStart(2, '0')} am - ${s}: ${b}`).join('\n');
  const seedNote = (notes: NoteRepository & { all: NoteRecord[] }, clientId: string, chatText: string) => {
    const msgs = parseWhatsAppExport(chatText);
    notes.all.push({ id: `seed-${clientId}`, userId: 'u', clientId, source: 'whatsapp_export', status: 'extracted', messages: msgs.ok ? (msgs.messages as ImportedMessage[]) : [], createdAt: 0 } as unknown as NoteRecord);
  };

  it('parse: an exact phone match auto-attaches (existing) and counts only the NEW messages', async () => {
    const clients = fakeClients([clientRecord('cX', 'u', 'Khalid', '+971501234567')]);
    const notes = fakeNotes();
    const storedPairs: Array<[string, string]> = [['Wabil', 'hi'], ['050 123 4567', 'hello']];
    seedNote(notes, 'cX', chatFrom(storedPairs));
    const { svc } = makeService({ clients, notes });
    const upload = chatFrom([...storedPairs, ['Wabil', 'and?'], ['050 123 4567', 'yes new']]);
    const out = await svc.parse('u', [{ name: 'a.txt', content: upload }], 'Wabil');
    expect(out.result.rows[0]!.state).toBe('existing');
    expect(out.result.rows[0]!.matchKind).toBe('phone');
    expect(out.result.rows[0]!.matchClientId).toBe('cX');
    expect(out.result.rows[0]!.newMessageCount).toBe(2); // only the 2 new messages
  });

  it('parse: a same-chat re-export under a different saved name auto-attaches by message overlap', async () => {
    const clients = fakeClients([clientRecord('cX', 'u', 'Imtinan')]);
    const notes = fakeNotes();
    const stored: Array<[string, string]> = [['Wabil', 'salaam'], ['Bubu DXB', 'the Marina unit?']];
    seedNote(notes, 'cX', chatFrom(stored));
    const { svc } = makeService({ clients, notes });
    const upload = chatFrom([...stored, ['Wabil', 'still interested?'], ['Bubu DXB', 'yes']]);
    const out = await svc.parse('u', [{ name: 'a.txt', content: upload }], 'Wabil');
    expect(out.result.rows[0]!.state).toBe('existing'); // attached by overlap, no question
    expect(out.result.rows[0]!.matchClientId).toBe('cX');
    expect(out.result.rows[0]!.newMessageCount).toBe(2);
  });

  it('parse: a name-only match with no message overlap STILL asks "Same person?" (never auto-attach)', async () => {
    const clients = fakeClients([clientRecord('cX', 'u', 'Ahmed')]);
    const notes = fakeNotes(); // no stored messages → no overlap
    const { svc } = makeService({ clients, notes });
    const out = await svc.parse('u', [{ name: 'a.txt', content: androidChat('Wabil', 'Ahmed') }], 'Wabil');
    expect(out.result.rows[0]!.state).toBe('possible_match');
    expect(out.result.rows[0]!.matchKind).toBe('name');
  });

  it('importConfirmed merge: 30 stored + 10 new → extracts only the 10 new, no duplicate facts', async () => {
    const clients = fakeClients([clientRecord('cX', 'u', 'Khalid')]);
    const notes = fakeNotes();
    const oldPairs: Array<[string, string]> = Array.from({ length: 15 }, (_, i) => ['Khalid', `m${i}`] as [string, string]); // 15 msgs
    const old = chatFrom(oldPairs);
    seedNote(notes, 'cX', old);
    const { svc, extract } = makeService({ clients, notes });
    const upload = chatFrom([...oldPairs, ...Array.from({ length: 10 }, (_, i) => ['Khalid', `n${i}`] as [string, string])]);
    await svc.importConfirmed('u', [{ name: 'a.txt', content: upload }], [{ fileName: 'a.txt', action: 'merge', clientId: 'cX' }], '2026-10-04');
    const created = notes.all.filter((n) => n.id !== 'seed-cX');
    expect(created).toHaveLength(1);
    expect(created[0]!.messages).toHaveLength(10); // only the new tail stored + extracted
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('importConfirmed merge: nothing new → "Already up to date", not imported', async () => {
    const clients = fakeClients([clientRecord('cX', 'u', 'Khalid')]);
    const notes = fakeNotes();
    const chat = chatFrom([['Khalid', 'a'], ['Khalid', 'b']]);
    seedNote(notes, 'cX', chat);
    const { svc, extract } = makeService({ clients, notes });
    const res = await svc.importConfirmed('u', [{ name: 'a.txt', content: chat }], [{ fileName: 'a.txt', action: 'merge', clientId: 'cX' }], '2026-10-04');
    expect(res.skipped).toBe(1);
    expect(res.created).toBe(0);
    expect(notes.all.filter((n) => n.id !== 'seed-cX')).toHaveLength(0);
    expect(extract).not.toHaveBeenCalled();
  });

  it('one chat failing to extract never fails the batch', async () => {
    const extract = vi.fn(async (_u: string, id: string): Promise<ExtractOutcome> => {
      if (id === 'n2') throw new Error('boom');
      return { status: 'extracted' };
    });
    const { svc } = makeService({ extract });
    const res = await svc.importConfirmed('u', [
      { name: 'a.txt', content: androidChat('Wabil', 'Layla') },
      { name: 'b.txt', content: androidChat('Wabil', 'Omar') },
    ], [
      { fileName: 'a.txt', action: 'new', name: 'Layla' },
      { fileName: 'b.txt', action: 'new', name: 'Omar' },
    ], '2026-10-04');
    const states = res.jobs.map((j) => j.state).sort();
    expect(states).toEqual(['done', 'failed']);
  });
});
