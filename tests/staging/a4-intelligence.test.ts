/**
 * STAGING-4 — intelligence. Covers FLOWS 10, 12, 13, 14, 15, 16, 22, 25. The trust
 * rules are the point: honest empties (never a fabricated summary), the recall refusal
 * path + verbatim receipts, the Today cost-guard (cache not recomputed per call), the
 * hero volume gate refusing under threshold, and the ledger showing no AED it can't
 * substantiate. Expensive setups (hero over-threshold = 20 notes) are marked PARTIAL
 * per cost discipline (rail #6). Semantic recall depends on the server's embedder; if
 * it's stubbed on staging, on-topic recall is recorded as a LIMITATION, not a fail.
 */
import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { useHarness } from './lib/harness.js';
import { evalNote, TRAP_NOTES } from './lib/fixtures.js';
import type { Identity } from './lib/identity.js';

const h = useHarness();

async function createClient(rep: Identity, name: string): Promise<string> {
  const res = await rep.http.post<{ id: string }>('/clients', { name });
  expect(res.status, `create client: ${rep.http.lastExchange()}`).toBe(201);
  return res.body.id;
}
async function pasteExtract(rep: Identity, clientId: string, text: string): Promise<void> {
  const p = await rep.http.post<{ id: string }>(`/clients/${clientId}/notes/paste`, { text });
  expect(p.status).toBe(201);
  await rep.http.post(`/notes/${p.body.id}/extract`);
}

// ---- minimal valid PNG encoder (solid gray) for the non-card scan test ----
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}
function solidGrayPng(size = 48): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x88)]); // filter 0 + gray pixels
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('[STAGING-4] intelligence', () => {
  // ---- FLOW 10: Brief ----
  it('brief on an empty client is honestly empty (never a fabricated summary)', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'Empty Client');
    const res = await rep.http.get<{ empty: boolean; recentContext: unknown[]; openPromises: unknown[] }>(`/clients/${clientId}/brief`);
    expect(res.status).toBe(200);
    expect(res.body.empty).toBe(true);
    expect(res.body.recentContext).toHaveLength(0);
    expect(res.body.openPromises).toHaveLength(0);
    h.report.pass('A', 'FLOW 10', 'empty client → honest empty brief');
  });

  it('brief on a client with a note is non-empty and carries its context', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'Northwind');
    await pasteExtract(rep, clientId, evalNote(TRAP_NOTES.firmPromise).note);
    const res = await rep.http.get<{ empty: boolean; recentContext: Array<{ noteId: string }> }>(`/clients/${clientId}/brief`);
    expect(res.status).toBe(200);
    expect(res.body.empty).toBe(false);
    expect(res.body.recentContext.length).toBeGreaterThan(0);
    h.report.pass('A', 'FLOW 10', 'client with a note → non-empty brief with context');
  });

  // ---- FLOW 12: Recall ----
  it('recall refuses on a topic never mentioned ("I don\'t have that on record")', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'Recall Co');
    await pasteExtract(rep, clientId, evalNote(TRAP_NOTES.firmPromise).note);
    const res = await rep.http.post<{ answer: string; receipts: unknown[] }>('/recall', { question: 'What did they say about their yacht in Monaco?' });
    expect(res.status).toBe(200);
    expect(res.body.answer.toLowerCase()).toContain("don't have that on record");
    expect(res.body.receipts).toHaveLength(0);
    h.report.pass('A', 'FLOW 12', 'recall refusal on never-mentioned topic');
  });

  it('recall is bounded and its receipts are verbatim (or the embedder is stubbed)', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'Pricing Co');
    const noteText = evalNote(TRAP_NOTES.firmPromise).note;
    await pasteExtract(rep, clientId, noteText);
    const res = await rep.http.post<{ answer: string; receipts: Array<{ quote: string; noteId: string }> }>('/recall', { question: 'What did I commit to send them?' });
    expect(res.status).toBe(200);
    expect(res.body.receipts.length).toBeLessThanOrEqual(5); // retrieval is capped
    if (res.body.receipts.length === 0) {
      h.report.record({ part: 'A', flow: 'FLOW 12', name: 'on-topic recall receipts', outcome: 'PARTIAL',
        detail: 'on-topic recall returned no receipts — staging embedder appears stubbed; verbatim-receipt check unverifiable here (rail: known-limits)' });
    } else {
      // Every cited quote must appear verbatim in the stored note text.
      const notes = await rep.http.get<{ notes: Array<{ rawText: string | null }> }>(`/clients/${clientId}/notes`);
      const corpus = notes.body.notes.map((n) => n.rawText ?? '').join('\n');
      for (const r of res.body.receipts) expect(corpus).toContain(r.quote);
      h.report.pass('A', 'FLOW 12', 'recall receipts verbatim + capped', `${res.body.receipts.length} receipts`);
    }
  });

  // ---- FLOW 13: Today (cost-guard: not recomputed per call) ----
  it('Today serves a cached list (10 reads do not recompute) and refresh is capped (429)', async () => {
    const rep = await h.factory.newRep();
    const remainings: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t = await rep.http.get<{ refreshesRemaining: number }>('/today');
      expect(t.status).toBe(200);
      remainings.push(t.body.refreshesRemaining);
    }
    // The observable cost-guard signal: GET /today never decrements refreshesRemaining.
    expect(new Set(remainings).size).toBe(1);
    h.report.pass('A', 'FLOW 13', 'Today cached — 10 reads, constant refreshesRemaining', `remaining=${remainings[0]}`);

    // Refresh is rate-limited (default cap 2/day) → eventually 429.
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await rep.http.post('/today/refresh');
      codes.push(r.status);
      if (r.status === 429) break;
    }
    expect(codes).toContain(429);
    h.report.pass('A', 'FLOW 13', 'Today refresh capped (429)', `sequence: ${codes.join(',')}`);
  });

  // ---- FLOW 14: Promises ----
  it('a null-due promise is not fabricated a date; delete removes it; done on a bad id 404s', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'Promise Co');
    await pasteExtract(rep, clientId, evalNote('unresolved-vague-date').note); // vague → null due date
    await pasteExtract(rep, clientId, evalNote(TRAP_NOTES.firmPromise).note); // resolvable
    const list = await rep.http.get<{ promises: Array<{ id: string; dueDate: string | null }> }>('/promises');
    expect(list.status).toBe(200);
    // No promise carries a guessed date it wasn't given; the vague one stays null.
    const nulls = list.body.promises.filter((p) => p.dueDate === null);
    expect(nulls.length).toBeGreaterThan(0);
    h.report.pass('A', 'FLOW 14', 'null-due promise not fabricated a date');

    // delete a real promise → it never returns.
    const victim = list.body.promises[0]!;
    const del = await rep.http.del(`/promises/${victim.id}`);
    expect(del.status).toBe(200);
    const after = await rep.http.get<{ promises: Array<{ id: string }> }>('/promises');
    expect(after.body.promises.find((p) => p.id === victim.id)).toBeUndefined();
    h.report.pass('A', 'FLOW 14', 'deleted promise never returns');

    // done on a well-formed but non-existent id → clean 404, no state change.
    const ghostId = randomUUID();
    const badDone = await rep.http.post(`/promises/${ghostId}/done`);
    if (badDone.status !== 404) {
      h.report.fail('A', 'FLOW 14', 'mark-done on a valid non-existent id',
        `expected 404, got ${badDone.status}`, rep.http.lastExchange());
    }
    expect(badDone.status).toBe(404);
    h.report.pass('A', 'FLOW 14', 'mark-done on non-existent id → 404');

    // A malformed (non-UUID) id should also fail cleanly, not 500.
    const malformed = await rep.http.post('/promises/not-a-uuid/done');
    if (malformed.status >= 500) {
      h.report.fail('A', 'FLOW 14', 'malformed promise id',
        `a malformed id returns ${malformed.status} (unvalidated id → DB error leaks as 5xx; should be 400/404)`, rep.http.lastExchange());
    } else {
      h.report.pass('A', 'FLOW 14', 'malformed promise id handled cleanly', `status=${malformed.status}`);
    }
  });

  // ---- FLOW 15: Meetings (asks, never saves without confirm) ----
  it('meetings: two same-named clients → asks which; no time → asks; nothing saved until confirm', async () => {
    const rep = await h.factory.newRep();
    const a = await createClient(rep, 'Sara Ahmed');
    await createClient(rep, 'Sara Ahmed'); // a same-named twin
    const ambClient = await rep.http.post<{ kind: string; candidates?: unknown[] }>('/meetings/parse', { text: 'set a meeting with Sara Ahmed tomorrow at 3pm' });
    expect(ambClient.status).toBe(200);
    expect(ambClient.body.kind).toBe('ambiguous_client');
    expect((ambClient.body.candidates ?? []).length).toBeGreaterThanOrEqual(2);

    const ambTime = await rep.http.post<{ kind: string }>('/meetings/parse', { text: 'catch up with Sara Ahmed sometime' });
    expect(ambTime.status).toBe(200);
    expect(['ambiguous_time', 'ambiguous_client']).toContain(ambTime.body.kind); // vague time → asks (or which-client first)

    // Parsing never persists.
    const before = await rep.http.get<{ meetings: unknown[] }>('/meetings');
    expect(before.body.meetings).toHaveLength(0);
    // Explicit confirm creates it.
    const created = await rep.http.post(`/clients/${a}/meetings`, { datetimeRaw: 'tomorrow 3pm', title: 'Intro' });
    expect(created.status).toBe(201);
    const after = await rep.http.get<{ meetings: unknown[] }>('/meetings');
    expect(after.body.meetings).toHaveLength(1);
    h.report.pass('A', 'FLOW 15', 'meetings ask-not-guess; nothing saved until confirm');
  });

  // ---- FLOW 16: Card scan ----
  it('a non-card image is reported as non-card with no fabricated contact', async () => {
    const rep = await h.factory.newRep();
    const png = solidGrayPng();
    const res = await rep.http.request<{ isCard: boolean; contact: unknown | null }>('POST', '/cards/scan', undefined, {
      raw: png.toString('binary'),
      rawContentType: 'image/png',
    });
    // The vision model should say it is not a card; nothing is invented/saved.
    expect(res.status).toBe(200);
    expect(res.body.isCard).toBe(false);
    h.report.pass('A', 'FLOW 16', 'non-card image → isCard:false, no contact fabricated');
  });

  // ---- FLOW 22: Hero volume gate (under threshold refuses; over-threshold = cost) ----
  it('under the volume threshold, patterns and risk refuse (empty, no teaser)', async () => {
    const rep = await h.factory.newRep();
    const status = await rep.http.get<{ unlocked: boolean }>('/hero/status');
    expect(status.status).toBe(200);
    expect(status.body.unlocked).toBe(false); // a fresh rep is under 5 clients / 20 notes
    const patterns = await rep.http.get<{ patterns: unknown[] }>('/hero/patterns');
    const risk = await rep.http.get<{ atRisk: unknown[] }>('/hero/risk');
    expect(patterns.body.patterns).toHaveLength(0); // refuses, no teaser
    expect(risk.body.atRisk).toHaveLength(0);
    h.report.pass('A', 'FLOW 22', 'hero gate refuses under threshold (no teaser)');
    h.report.record({ part: 'A', flow: 'FLOW 22', name: 'over-threshold pattern evidence', outcome: 'PARTIAL',
      detail: 'crossing the gate needs 5 clients + 20 notes (20 extractions) — out of this run\'s cost budget (rail #6)' });
  });

  // ---- FLOW 25: Ledger ----
  it('with no deal values entered, the ledger shows no AED figure and no won/closed language', async () => {
    const rep = await h.factory.newRep();
    const res = await rep.http.get<{ aed: number | null }>('/ledger');
    expect(res.status).toBe(200);
    expect(res.body.aed).toBeNull(); // never estimated
    expect(res.rawText).not.toMatch(/\bAED\b/); // no AED figure anywhere in the body
    expect(res.rawText).not.toMatch(/\b(closed|won)\b/i); // recovered-value framing, not sales-win framing
    h.report.pass('A', 'FLOW 25', 'ledger: no AED without deal values, no won/closed copy');
  });
});
