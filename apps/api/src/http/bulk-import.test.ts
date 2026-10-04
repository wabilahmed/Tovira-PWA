import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { deflateRawSync } from 'node:zlib';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

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
  const res = await fetch(`${base}/auth/signup`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  return ((await res.json()) as { token: string }).token;
}
const chat = (rep: string, other: string) =>
  [`13/07/2019, 1:00 am - ${rep}: hi`, `13/07/2019, 1:01 am - ${other}: hello about the Marina quote`].join('\n');
const post = (path: string, token: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

describe('[BULK-IMPORT] POST /import/bulk', () => {
  it('requires auth on both endpoints', async () => {
    expect((await fetch(`${base}/import/bulk/parse`, { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/import/bulk`, { method: 'POST', body: '{}' })).status).toBe(401);
  });

  it('parse returns a per-file review result plus the up-front % estimate, with NO extraction', async () => {
    const token = await signup('bulkparse@example.com');
    const res = await post('/import/bulk/parse', token, {
      repName: 'Wabil',
      files: [{ name: 'a.txt', content: chat('Wabil', 'Layla') }, { name: 'b.txt', content: chat('Wabil', 'Omar') }],
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('estimateAed'); // D3: no AED usage value reaches the client
    expect(raw).not.toContain('addedAed');
    const body = JSON.parse(raw) as { result: { rows: unknown[] }; percentOfAllowance: number; upsell: { canTopUp: boolean; shortfall: boolean; options: unknown[] } };
    expect(body.result.rows).toHaveLength(2);
    expect(body.percentOfAllowance).toBeGreaterThan(0);
    // A fresh (unsubscribed) account is a trial → no top-up options (the web shows Subscribe).
    expect(body.upsell.canTopUp).toBe(false);
    expect(body.upsell.options).toEqual([]);
  });

  it('the first import requires the right-to-upload acknowledgement (428)', async () => {
    const token = await signup('bulkack@example.com');
    const res = await post('/import/bulk', token, {
      files: [{ name: 'a.txt', content: chat('Wabil', 'Layla') }],
      decisions: [{ fileName: 'a.txt', action: 'new', name: 'Layla' }],
    });
    expect(res.status).toBe(428);
  });

  it('imports confirmed chats: creates clients + notes and extracts each in its own call', async () => {
    const token = await signup('bulkgo@example.com');
    const res = await post('/import/bulk', token, {
      firstImportAck: true,
      files: [{ name: 'a.txt', content: chat('Wabil', 'Layla') }, { name: 'b.txt', content: chat('Wabil', 'Omar') }],
      decisions: [
        { fileName: 'a.txt', action: 'new', name: 'Layla' },
        { fileName: 'b.txt', action: 'new', name: 'Omar' },
      ],
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobs: Array<{ key: string; noteId?: string; state: string }>; created: number; skipped: number };
    expect(body.created).toBe(2);
    // The stub model returns valid JSON, so each chat extracts to done — one note, one call each.
    expect(body.jobs).toHaveLength(2);
    expect(body.jobs.every((j) => j.state === 'done' && j.noteId)).toBe(true);
    // The two clients were created under the confirmed names.
    const listed = (await (await fetch(`${base}/clients`, { headers: { authorization: `Bearer ${token}` } })).json()) as { clients: Array<{ name: string }> };
    expect(listed.clients.map((c) => c.name).sort()).toEqual(['Layla', 'Omar']);
  });

  it('accepts a base64 iOS .zip file (decoded to its transcript, media dropped)', async () => {
    const token = await signup('bulkzip@example.com');
    const zip = makeZip([
      { name: '_chat.txt', data: Buffer.from(chat('Wabil', 'Imtinan')), deflate: true },
      { name: 'IMG.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) },
    ]);
    const res = await post('/import/bulk/parse', token, { repName: 'Wabil', files: [{ name: 'chat.zip', contentBase64: zip.toString('base64') }] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { rows: Array<{ counterpart: string | null; state: string }> } };
    expect(body.result.rows[0]!.counterpart).toBe('Imtinan');
    expect(body.result.rows[0]!.state).not.toBe('unparseable');
  });

  it('rejects a batch over the 20-file cap', async () => {
    const token = await signup('bulkcap@example.com');
    const files = Array.from({ length: 21 }, (_, i) => ({ name: `f${i}.txt`, content: chat('Wabil', `C${i}`) }));
    const res = await post('/import/bulk/parse', token, { repName: 'Wabil', files });
    expect(res.status).toBe(413);
  });
});
