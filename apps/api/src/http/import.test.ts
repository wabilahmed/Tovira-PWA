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

async function signup(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${base}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  const text = await res.text();
  if (res.status !== 201) throw new Error(`signup(${email}) → ${res.status}: ${text}`);
  const body = JSON.parse(text) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

async function createClient(token: string, name: string): Promise<string> {
  const res = await fetch(`${base}/clients`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return ((await res.json()) as { id: string }).id;
}

const EXPORT = [
  '[2026-01-15, 09:12:03] Sara Lee: Morning! Did the revised quote come through?',
  '[2026-01-15, 09:40:11] Alex Rep: Sending it over today.',
  'It has the bulk discount baked in.',
  '[2026-03-02, 14:05:00] Sara Lee: ‎<Media omitted>',
  '[2026-03-02, 14:06:00] Sara Lee: Thanks — looks good.',
].join('\n');

function importChat(token: string, clientId: string, body: unknown): Promise<Response> {
  return fetch(`${base}/clients/${clientId}/notes/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function listNotes(token: string, cid: string): Promise<Array<{ id: string; source: string; status: string; extracted: { unanswered_questions?: Array<{ question: string }> } | null; messages: Array<{ sender: string; sentAt: string | null; body: string; media: boolean }> | null }>> {
  return ((await (await fetch(`${base}/clients/${cid}/notes`, { headers: { authorization: `Bearer ${token}` } })).json()) as { notes: Array<{ id: string; source: string; status: string; extracted: { unanswered_questions?: Array<{ question: string }> } | null; messages: Array<{ sender: string; sentAt: string | null; body: string; media: boolean }> | null }> }).notes;
}

/** IMPORT-ASYNC: import defers extraction to the sweep; the tests model the sweep by
 *  calling the same /extract seam on the imported note. */
async function drainImport(token: string, cid: string): Promise<void> {
  const note = (await listNotes(token, cid)).find((n) => n.source === 'whatsapp_export' && n.status === 'pending_extraction');
  if (note) await fetch(`${base}/notes/${note.id}/extract`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
}

describe('[P1-4b] import a WhatsApp chat export', () => {
  it('IMPORT-ASYNC: import persists messages and returns 202 pending WITHOUT extracting inline', async () => {
    const { token } = await signup('import@example.com');
    const cid = await createClient(token, 'Acme');

    const res = await importChat(token, cid, { content: EXPORT, consent: true });
    // 202 Accepted — extraction is deferred, so a slow model can never 504 the upload.
    expect(res.status).toBe(202);
    const body = (await res.json()) as { note: { id: string; source: string }; imported: number; status: string };
    expect(body.imported).toBe(4); // 4 messages (the continuation line folds into #2)
    expect(body.note.source).toBe('whatsapp_export');
    expect(body.status).toBe('pending_extraction');

    // Messages are durably persisted immediately, speaker-attributed, in order — but
    // the note is still pending (no inline extraction happened).
    const imported = (await listNotes(token, cid)).find((n) => n.source === 'whatsapp_export')!;
    expect(imported.messages).toHaveLength(4);
    expect(imported.messages![0]).toMatchObject({ sender: 'Sara Lee', sentAt: '2026-01-15T09:12:03' });
    expect(imported.messages![1]!.body).toContain('bulk discount'); // multi-line folded in
    expect(imported.messages![2]!.media).toBe(true); // media placeholder flagged
    expect(imported.status).toBe('pending_extraction'); // NOT extracted inline
    expect(imported.extracted).toBeNull();

    // The background sweep (modeled by /extract) then advances it to extracted.
    await drainImport(token, cid);
    const after = (await listNotes(token, cid)).find((n) => n.source === 'whatsapp_export')!;
    expect(after.status).toBe('extracted');
  });

  // IMPORT-ASYNC: the reported 504 scenario — a larger multi-message chat. It must
  // return promptly (202) with every message persisted, no matter how slow the model
  // is, because extraction no longer runs inside the request.
  it('a larger multi-message import returns 202 promptly with all messages persisted', async () => {
    const { token } = await signup('bigimport@example.com');
    const cid = await createClient(token, 'Northwind');
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) {
      const speaker = i % 2 === 0 ? 'Northwind' : 'Alex Rep';
      lines.push(`[2026-04-${String((i % 27) + 1).padStart(2, '0')}, 09:${String(i % 60).padStart(2, '0')}:00] ${speaker}: message number ${i} about the deal`);
    }
    const res = await importChat(token, cid, { content: lines.join('\n'), consent: true });
    expect(res.status).toBe(202); // never blocks on extraction
    const body = (await res.json()) as { imported: number; status: string };
    expect(body.imported).toBe(40);
    expect(body.status).toBe('pending_extraction');
    // All 40 messages durably stored before we return — nothing lost.
    const note = (await listNotes(token, cid)).find((n) => n.source === 'whatsapp_export')!;
    expect(note.messages).toHaveLength(40);
  });

  // NEGATIVE: consent is required before anything is imported.
  it('does not import without explicit consent', async () => {
    const { token } = await signup('noconsent@example.com');
    const cid = await createClient(token, 'Acme');
    const res = await importChat(token, cid, { content: EXPORT, consent: false });
    expect(res.status).toBe(400);

    const notes = (await (await fetch(`${base}/clients/${cid}/notes`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as { notes: unknown[] };
    expect(notes.notes).toEqual([]); // nothing stored at all
  });

  // NEGATIVE: non-WhatsApp text is rejected; no messages written.
  it('rejects a non-WhatsApp .txt with a clear message and no partial history', async () => {
    const { token } = await signup('notwa@example.com');
    const cid = await createClient(token, 'Acme');
    const res = await importChat(token, cid, { content: 'just my notes\nno timestamps\nrandom text', consent: true });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/whatsapp/i);

    // The raw file may be persisted+flagged, but NO messages were written.
    const notes = (await (await fetch(`${base}/clients/${cid}/notes`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as { notes: Array<{ status: string; messages: unknown[] | null }> };
    for (const n of notes.notes) {
      expect(n.messages == null || (n.messages as unknown[]).length === 0).toBe(true);
    }
    expect(notes.notes.some((n) => n.status === 'import_failed')).toBe(true);
  });

  // P1-6: an unanswered client question in the imported thread is flagged. Extraction
  // is now async, so drain the sweep first, then read the extracted facts.
  async function importedExtract(token: string, cid: string): Promise<{ unanswered_questions: Array<{ question: string }> }> {
    await drainImport(token, cid);
    const note = (await listNotes(token, cid)).find((n) => n.source === 'whatsapp_export')!;
    return note.extracted as { unanswered_questions: Array<{ question: string }> };
  }

  it('flags a client question the thread went dead on (P1-6)', async () => {
    const { token } = await signup('unans@example.com');
    const cid = await createClient(token, 'Sara Lee'); // client name matches the speaker
    const chat = [
      '[2026-01-15, 09:00:00] Alex: Sending the quote.',
      '[2026-01-16, 10:00:00] Sara Lee: Can you do bulk pricing?',
    ].join('\n');
    await importChat(token, cid, { content: chat, consent: true });
    const extracted = await importedExtract(token, cid);
    expect(extracted.unanswered_questions).toHaveLength(1);
    expect(extracted.unanswered_questions[0]!.question).toContain('bulk pricing');
  });

  it('does not flag a question the rep answered after (P1-6 negative)', async () => {
    const { token } = await signup('answered@example.com');
    const cid = await createClient(token, 'Sara Lee');
    const chat = [
      '[2026-01-15, 09:00:00] Sara Lee: Can you do bulk pricing?',
      '[2026-01-15, 09:05:00] Alex: Yes — 10% above 500 units.',
    ].join('\n');
    await importChat(token, cid, { content: chat, consent: true });
    const extracted = await importedExtract(token, cid);
    expect(extracted.unanswered_questions).toEqual([]);
  });

  // P3-7: re-import dedupes — overlapping messages stored once, only the new tail.
  it('deduplicates a re-import and extracts only the new tail', async () => {
    const { token } = await signup('reimport@example.com');
    const cid = await createClient(token, 'Sara Lee');
    const first = ['[2026-01-15, 09:00:00] Sara Lee: hi', '[2026-01-16, 10:00:00] Alex: hello'].join('\n');
    const r1 = await importChat(token, cid, { content: first, consent: true });
    expect(((await r1.json()) as { imported: number }).imported).toBe(2);

    const second = [first, '[2026-02-01, 11:00:00] Sara Lee: can you do bulk pricing?'].join('\n');
    const r2 = await importChat(token, cid, { content: second, consent: true });
    expect(((await r2.json()) as { imported: number }).imported).toBe(1); // only the new message
  });

  // P3-7: re-importing the identical file is a no-op (idempotent).
  it('adds nothing when the identical file is re-imported', async () => {
    const { token } = await signup('idem@example.com');
    const cid = await createClient(token, 'Sara Lee');
    const chat = '[2026-01-15, 09:00:00] Sara Lee: hi';
    await importChat(token, cid, { content: chat, consent: true });
    const r2 = await importChat(token, cid, { content: chat, consent: true });
    const body = (await r2.json()) as { imported: number; duplicate?: boolean };
    expect(body.imported).toBe(0);
    expect(body.duplicate).toBe(true);
  });

  // NEGATIVE: a rep can never import into, or read, another rep's client.
  it('does not let a rep import into another rep\'s client', async () => {
    const a = await signup('a-import@example.com');
    const b = await signup('b-import@example.com');
    const cid = await createClient(a.token, 'A-owned');
    const res = await importChat(b.token, cid, { content: EXPORT, consent: true });
    expect(res.status).toBe(404);
  });
});

// --- IMPORT-ZIP: what WhatsApp actually exports (a .zip), uploaded as base64 bytes ---
const zu16 = (n: number) => { const x = Buffer.alloc(2); x.writeUInt16LE(n); return x; };
const zu32 = (n: number) => { const x = Buffer.alloc(4); x.writeUInt32LE(n); return x; };
function makeZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const nb = Buffer.from(e.name, 'utf8');
    const lfh = Buffer.concat([zu32(0x04034b50), zu16(20), zu16(0), zu16(0), zu16(0), zu16(0), zu32(0), zu32(e.data.length), zu32(e.data.length), zu16(nb.length), zu16(0), nb, e.data]);
    locals.push(lfh);
    centrals.push(Buffer.concat([zu32(0x02014b50), zu16(20), zu16(20), zu16(0), zu16(0), zu16(0), zu16(0), zu32(0), zu32(e.data.length), zu32(e.data.length), zu16(nb.length), zu16(0), zu16(0), zu16(0), zu16(0), zu32(0), zu32(offset), nb]));
    offset += lfh.length;
  }
  const cd = Buffer.concat(centrals); const all = Buffer.concat(locals);
  const eocd = Buffer.concat([zu32(0x06054b50), zu16(0), zu16(0), zu16(entries.length), zu16(entries.length), zu32(cd.length), zu32(all.length), zu16(0)]);
  return Buffer.concat([all, cd, eocd]);
}

describe('[IMPORT-ZIP] accept what WhatsApp actually exports', () => {
  it('imports an iOS-shaped zip (_chat.txt + media) uploaded as base64', async () => {
    const { token } = await signup('zip-ios@example.com');
    const cid = await createClient(token, 'Sara Lee');
    const zip = makeZip([
      { name: '_chat.txt', data: Buffer.from(EXPORT) },
      { name: 'IMG-20260115.jpg', data: Buffer.from([0x00, 0xff, 0xd8, 0x00]) },
    ]);
    const res = await importChat(token, cid, { contentBase64: zip.toString('base64'), consent: true });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { imported: number };
    expect(body.imported).toBeGreaterThan(0);
    const notes = await listNotes(token, cid);
    expect(notes.some((n) => n.source === 'whatsapp_export' && (n.messages?.length ?? 0) > 0)).toBe(true);
  });

  it('imports a zip whose transcript has a localised (non _chat) filename — detection is by content', async () => {
    const { token } = await signup('zip-loc@example.com');
    const cid = await createClient(token, 'Sara Lee');
    const zip = makeZip([{ name: 'Discussion WhatsApp avec Sara.txt', data: Buffer.from(EXPORT) }]);
    const res = await importChat(token, cid, { contentBase64: zip.toString('base64'), consent: true });
    expect(res.status).toBe(202);
  });

  it('rejects a zip with no transcript, naming what was found (422)', async () => {
    const { token } = await signup('zip-empty@example.com');
    const cid = await createClient(token, 'Sara Lee');
    const zip = makeZip([{ name: 'readme.txt', data: Buffer.from('nothing chat-shaped here') }]);
    const res = await importChat(token, cid, { contentBase64: zip.toString('base64'), consent: true });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toMatch(/no whatsapp transcript/i);
    expect(body.reason).toContain('readme.txt');
  });

  it('still accepts a bare .txt uploaded as base64 (the picker path)', async () => {
    const { token } = await signup('txt-b64@example.com');
    const cid = await createClient(token, 'Sara Lee');
    const res = await importChat(token, cid, { contentBase64: Buffer.from(EXPORT).toString('base64'), consent: true });
    expect(res.status).toBe(202);
  });
});

// --- MISFILE-DETECT (B1): confirm, never block; suggest, never auto-reassign ---
const AHMED_CHAT = [
  '[2026-03-15, 14:22] Ahmed: still looking for a 3-bed in Mirdif?',
  '[2026-03-15, 14:25] Me: yes, sending options today',
].join('\n');

describe('[MISFILE-DETECT] a chat filed under the wrong client', () => {
  it('imports without a prompt when the counterpart matches the client', async () => {
    const { token } = await signup('mf-ok@example.com');
    const cid = await createClient(token, 'Ahmed');
    const res = await importChat(token, cid, { content: AHMED_CHAT, consent: true });
    expect(res.status).toBe(202);
  });

  it('holds the import (409) and suggests the right client on a clear mismatch', async () => {
    const { token } = await signup('mf-mismatch@example.com');
    await createClient(token, 'Ahmed'); // the likely-correct client
    const meridian = await createClient(token, 'Meridian');
    const res = await importChat(token, meridian, { content: AHMED_CHAT, consent: true });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; counterparts: string[]; suggestion: { name: string } | null; message: string };
    expect(body.error).toBe('misfile_suspected');
    expect(body.counterparts).toContain('Ahmed');
    expect(body.suggestion?.name).toBe('Ahmed');
    expect(body.message).toMatch(/filing it under Meridian/i);
    // NEVER auto-reassigned: nothing was stored under Meridian.
    const notes = await listNotes(token, meridian);
    expect(notes.filter((n) => n.source === 'whatsapp_export')).toHaveLength(0);
  });

  it('proceeds and records the override when the rep acknowledges', async () => {
    const { token } = await signup('mf-override@example.com');
    await createClient(token, 'Ahmed');
    const meridian = await createClient(token, 'Meridian');
    const first = await importChat(token, meridian, { content: AHMED_CHAT, consent: true });
    expect(first.status).toBe(409);
    // Rep insists: file it under Meridian anyway.
    const res = await importChat(token, meridian, { content: AHMED_CHAT, consent: true, misfileAck: true });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { imported: number; misfileOverridden?: boolean };
    expect(body.imported).toBeGreaterThan(0);
    expect(body.misfileOverridden).toBe(true);
    const notes = await listNotes(token, meridian);
    expect(notes.some((n) => n.source === 'whatsapp_export')).toBe(true);
  });
});

describe('[NOTE-MOVE/IMPORT-UNDO] move and undo routes (B3/B4)', () => {
  async function importedNote(token: string, cid: string): Promise<string> {
    await importChat(token, cid, { content: AHMED_CHAT, consent: true, misfileAck: true });
    return (await listNotes(token, cid)).find((n) => n.source === 'whatsapp_export')!.id;
  }

  it('previews, then moves a note (and its messages) to another client', async () => {
    const { token } = await signup('move@example.com');
    const ahmed = await createClient(token, 'Ahmed');
    const meridian = await createClient(token, 'Meridian');
    const noteId = await importedNote(token, meridian); // misfiled under Meridian

    const preview = await fetch(`${base}/notes/${noteId}/move-preview`, { headers: { authorization: `Bearer ${token}` } });
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { counts: { messages: number } }).counts.messages).toBeGreaterThan(0);

    const move = await fetch(`${base}/notes/${noteId}/move`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ toClientId: ahmed }),
    });
    expect(move.status).toBe(200);
    // It now lives under Ahmed, and no longer under Meridian.
    expect((await listNotes(token, ahmed)).some((n) => n.id === noteId)).toBe(true);
    expect((await listNotes(token, meridian)).some((n) => n.id === noteId)).toBe(false);
  });

  it('rejects a move to a nonexistent client and a same-client move', async () => {
    const { token } = await signup('move-bad@example.com');
    const meridian = await createClient(token, 'Meridian');
    const noteId = await importedNote(token, meridian);
    const toNowhere = await fetch(`${base}/notes/${noteId}/move`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ toClientId: 'nope' }) });
    expect(toNowhere.status).toBe(404);
    const toSame = await fetch(`${base}/notes/${noteId}/move`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ toClientId: meridian }) });
    expect(toSame.status).toBe(409);
  });

  it('undoes an import (removes the note) and is idempotent', async () => {
    const { token } = await signup('undo@example.com');
    const meridian = await createClient(token, 'Meridian');
    const noteId = await importedNote(token, meridian);
    const undo = await fetch(`${base}/notes/${noteId}/undo`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(undo.status).toBe(200);
    expect((await listNotes(token, meridian)).some((n) => n.id === noteId)).toBe(false);
    // A second undo is a no-op (already gone).
    const again = await fetch(`${base}/notes/${noteId}/undo`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(again.status).toBe(404);
  });

  it('a re-import after undo is treated as new, not a duplicate', async () => {
    const { token } = await signup('reimport-undo@example.com');
    const meridian = await createClient(token, 'Meridian');
    const noteId = await importedNote(token, meridian);
    await fetch(`${base}/notes/${noteId}/undo`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    const re = await importChat(token, meridian, { content: AHMED_CHAT, consent: true, misfileAck: true });
    expect(re.status).toBe(202); // not 200/duplicate — the undo cleared the prior messages
    expect(((await re.json()) as { imported: number }).imported).toBeGreaterThan(0);
  });
});
