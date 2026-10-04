import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { deflateRawSync } from 'node:zlib';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { MAX_IMPORT_UPLOAD_BYTES } from '../services/import/bulk-decode.js';

/** A valid Android export grown to ~approxBytes (Wabil + the counterpart), for the large-file tests. */
function bigChat(other: string, approxBytes: number): string {
  const out: string[] = [];
  let size = 0;
  for (let i = 0; size < approxBytes; i += 1) {
    const line = `13/07/2019, 1:00 am - ${i % 2 === 0 ? 'Wabil' : other}: message ${i} ${'x'.repeat(120)}`;
    out.push(line);
    size += line.length + 1;
  }
  return out.join('\n');
}

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

const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
function makeZip(entries: Array<{ name: string; data: Buffer; deflate?: boolean }>): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const method = e.deflate ? 8 : 0;
    const stored = e.deflate ? deflateRawSync(e.data) : e.data;
    const lfh = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0), u32(0), u32(stored.length), u32(e.data.length), u16(nameBuf.length), u16(0), nameBuf, stored]);
    locals.push(lfh);
    centrals.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0), u32(0), u32(stored.length), u32(e.data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf]));
    offset += lfh.length;
  }
  const cd = Buffer.concat(centrals); const localAll = Buffer.concat(locals);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(localAll.length), u16(0)]);
  return Buffer.concat([localAll, cd, eocd]);
}

async function signup(email: string): Promise<string> {
  const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  return ((await res.json()) as { token: string }).token;
}
const chat = (rep: string, other: string) =>
  [`13/07/2019, 1:00 am - ${rep}: hi`, `13/07/2019, 1:01 am - ${other}: hello about the Marina quote`].join('\n');
const post = (path: string, token: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const bytesOf = (s: string) => new TextEncoder().encode(s);
// [FIX 1 / FOLLOW-UP 1] Files upload as RAW BINARY — bytes in the body, metadata in X-Tovira-* headers.
const upload = (token: string, batchId: string, index: number, name: string, bytes: Uint8Array) =>
  fetch(`${base}/import/bulk/files`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-tovira-batch-id': batchId, 'x-tovira-index': String(index), 'x-tovira-name': encodeURIComponent(name) },
    body: bytes,
  });
async function pollDone(token: string, batchId: string): Promise<{ jobs: Array<{ key: string; state: string }>; done: boolean; upsell?: unknown }> {
  for (let i = 0; i < 50; i += 1) {
    const s = (await (await fetch(`${base}/import/bulk/${batchId}/status`, { headers: { authorization: `Bearer ${token}` } })).json()) as { jobs: Array<{ key: string; state: string }>; done: boolean; upsell?: unknown };
    if (s.done) return s;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('batch never finished');
}

describe('[BULK-IMPORT] the bulk endpoints (individual upload → parse → async import → poll)', () => {
  it('require auth', async () => {
    expect((await fetch(`${base}/import/bulk/files`, { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/import/bulk/parse`, { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/import/bulk`, { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/import/bulk/b1/status`)).status).toBe(401);
  });

  it('uploads files one at a time, then parse returns a review + % estimate + upsell, no AED usage (D3)', async () => {
    const token = await signup('bulkparse@example.com');
    await upload(token, 'b1', 0, 'a.txt', bytesOf(chat('Wabil', 'Layla')));
    await upload(token, 'b1', 1, 'b.txt', bytesOf(chat('Wabil', 'Omar')));
    const res = await post('/import/bulk/parse', token, { batchId: 'b1', repName: 'Wabil' });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('estimateAed');
    const body = JSON.parse(raw) as { result: { rows: unknown[] }; percentOfAllowance: number; upsell: { canTopUp: boolean } };
    expect(body.result.rows).toHaveLength(2);
    expect(body.percentOfAllowance).toBeGreaterThan(0);
    expect(body.upsell.canTopUp).toBe(false); // fresh account = trial → Subscribe, not top-ups
  });

  it('the first import requires the right-to-upload acknowledgement (428)', async () => {
    const token = await signup('bulkack@example.com');
    await upload(token, 'b1', 0, 'a.txt', bytesOf(chat('Wabil', 'Layla')));
    const res = await post('/import/bulk', token, { batchId: 'b1', decisions: [{ fileName: 'a.txt', action: 'new', name: 'Layla' }] });
    expect(res.status).toBe(428);
  });

  it('imports the confirmed chats in the background; polling status reaches done with all extracted', async () => {
    const token = await signup('bulkgo@example.com');
    await upload(token, 'b2', 0, 'a.txt', bytesOf(chat('Wabil', 'Layla')));
    await upload(token, 'b2', 1, 'b.txt', bytesOf(chat('Wabil', 'Omar')));
    const res = await post('/import/bulk', token, { batchId: 'b2', firstImportAck: true, decisions: [
      { fileName: 'a.txt', action: 'new', name: 'Layla' },
      { fileName: 'b.txt', action: 'new', name: 'Omar' },
    ] });
    expect(res.status).toBe(202);
    const final = await pollDone(token, 'b2');
    expect(final.jobs).toHaveLength(2);
    expect(final.jobs.every((j) => j.state === 'done')).toBe(true);
    // [FIX 2a] the staged input files are deleted once the import completes.
    const staged = (await deps.storage.list('bulk-import/')).filter((k) => k.includes('/b2/') && /\/f\d+\.json$/.test(k));
    expect(staged).toEqual([]);
    const listed = (await (await fetch(`${base}/clients`, { headers: { authorization: `Bearer ${token}` } })).json()) as { clients: Array<{ name: string }> };
    expect(listed.clients.map((c) => c.name).sort()).toEqual(['Layla', 'Omar']);
  });

  it('accepts a base64 iOS .zip file (decoded to its transcript, media dropped)', async () => {
    const token = await signup('bulkzip@example.com');
    const zip = makeZip([{ name: '_chat.txt', data: Buffer.from(chat('Wabil', 'Imtinan')), deflate: true }, { name: 'IMG.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) }]);
    await upload(token, 'bz', 0, 'chat.zip', new Uint8Array(zip));
    const res = await post('/import/bulk/parse', token, { batchId: 'bz', repName: 'Wabil' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { rows: Array<{ counterpart: string | null; state: string }> } };
    expect(body.result.rows[0]!.counterpart).toBe('Imtinan');
    expect(body.result.rows[0]!.state).not.toBe('unparseable');
  });

  it('rejects a file beyond the 20-file cap by index', async () => {
    const token = await signup('bulkcap@example.com');
    const res = await upload(token, 'bc', 20, 'f21.txt', bytesOf(chat('Wabil', 'C21')));
    expect(res.status).toBe(413);
  });

  it('[FIX 1] imports a 2 MB .txt and a 2 MB-equivalent .zip via raw upload (no 1 MB cap)', async () => {
    const token = await signup('bulk2mb@example.com');
    await upload(token, 'm1', 0, 'big.txt', bytesOf(bigChat('Layla', 2_000_000)));
    const zip = makeZip([{ name: '_chat.txt', data: Buffer.from(bigChat('Omar', 2_000_000)), deflate: true }]);
    await upload(token, 'm1', 1, 'big.zip', new Uint8Array(zip));
    const res = await post('/import/bulk/parse', token, { batchId: 'm1', repName: 'Wabil' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { rows: Array<{ fileName: string; state: string; counterpart: string | null }> } };
    const byName = Object.fromEntries(body.result.rows.map((r) => [r.fileName, r]));
    expect(byName['big.txt']!.state).not.toBe('unparseable');
    expect(byName['big.zip']!.state).not.toBe('unparseable');
  });

  it('[FIX 1] a file over the per-file byte limit fails only its own row (413)', async () => {
    const token = await signup('bulkbig@example.com');
    const res = await upload(token, 'm2', 0, 'huge.txt', new Uint8Array(MAX_IMPORT_UPLOAD_BYTES + 1));
    expect(res.status).toBe(413);
  });

  it('[FIX 3] heals an interrupted batch: unstarted → failed_interrupted, started → finished, batch done', async () => {
    const token = await signup('interrupted@example.com');
    const userId = ((await (await fetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } })).json()) as { user: { id: string } }).user.id;
    // A chat that was STARTED (its note exists and has since extracted).
    const note = await deps.notes.create(userId, { clientId: 'c', source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'extracted' });
    // A STALE status blob: the background worker died — one started (extracting), one never started (queued).
    const stale = { jobs: [{ key: 'a.txt', noteId: note.id, state: 'extracting' }, { key: 'b.txt', state: 'queued' }], done: false, updatedAt: Date.now() - 6 * 60 * 1000 };
    await deps.storage.put(`bulk-import/${userId}/bint/status.json`, new TextEncoder().encode(JSON.stringify(stale)));
    const res = await fetch(`${base}/import/bulk/bint/status`, { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json()) as { jobs: Array<{ key: string; state: string }>; done: boolean };
    expect(body.done).toBe(true); // the view finishes — never "importing" forever
    const by = Object.fromEntries(body.jobs.map((j) => [j.key, j.state]));
    expect(by['a.txt']).toBe('done'); // started → re-derived from its (extracted) note
    expect(by['b.txt']).toBe('failed_interrupted'); // never started → no note → interrupted
  });
});
