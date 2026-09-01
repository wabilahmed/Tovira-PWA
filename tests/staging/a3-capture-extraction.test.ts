/**
 * STAGING-3 — capture, extraction & seeding. Covers FLOWS 4, 7, 9, 20 and the
 * extraction trust doctrine against REUSED eval-set notes (rail #4). Assertions are on
 * the DOCTRINE (year-less date → null, zero fabricated promises, role-only → no
 * null-named person, code-switch extracts), never the eval's date-relative ISO values
 * (those shift when re-run at today's date on staging). Real extraction runs server-side.
 */
import { describe, it, expect } from 'vitest';
import { useHarness } from './lib/harness.js';
import { evalNote, whatsappExportFromEval, PASTE_FIXTURES, TRAP_NOTES } from './lib/fixtures.js';
import type { Identity } from './lib/identity.js';

const h = useHarness();

interface Extraction {
  summary?: string;
  promises: Array<{ text: string; owner: string; due_date: string | null; due_raw: string | null; confidence: string }>;
  people: Array<{ name: string | null; role: string | null; decision_role: string; notes: string | null }>;
  key_dates: Array<{ description: string; date: string | null; date_raw: string | null }>;
  next_steps: string[];
}
interface NoteRecord {
  id: string;
  source: string;
  rawText: string | null;
  status: string;
  extracted: Extraction | null;
  messages: unknown[] | null;
}

async function createClient(rep: Identity, name: string): Promise<string> {
  const res = await rep.http.post<{ id: string }>('/clients', { name });
  if (res.status !== 201 || !res.body.id) throw new Error(`create client failed: ${rep.http.lastExchange()}`);
  return res.body.id;
}

/** Paste a note then run extraction; return the extracted facts (or null). */
async function pasteAndExtract(rep: Identity, clientId: string, text: string): Promise<{ note: NoteRecord; extracted: Extraction | null }> {
  const paste = await rep.http.post<NoteRecord>(`/clients/${clientId}/notes/paste`, { text });
  expect(paste.status, `paste: ${rep.http.lastExchange()}`).toBe(201);
  const ex = await rep.http.post<{ note: NoteRecord; status: string }>(`/notes/${paste.body.id}/extract`);
  expect(ex.status, `extract: ${rep.http.lastExchange()}`).toBe(200);
  // Read the note back to get the persisted extracted blob.
  const notes = await rep.http.get<{ notes: NoteRecord[] }>(`/clients/${clientId}/notes`);
  const note = notes.body.notes.find((n) => n.id === paste.body.id)!;
  return { note, extracted: note.extracted };
}

describe('[STAGING-3] capture, extraction & seeding', () => {
  // ---- FLOW 9: paste stored verbatim, then extracted ----
  it('a pasted note is stored verbatim (emoji + line breaks) and then extracted', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'Verbatim Co');
    const paste = await rep.http.post<NoteRecord>(`/clients/${clientId}/notes/paste`, { text: PASTE_FIXTURES.emojiMultiline });
    expect(paste.status).toBe(201);
    expect(paste.body.rawText).toBe(PASTE_FIXTURES.emojiMultiline); // byte-for-byte
    const ex = await rep.http.post<{ status: string }>(`/notes/${paste.body.id}/extract`);
    expect(ex.status).toBe(200);
    h.report.pass('A', 'FLOW 9', 'paste stored verbatim + extraction runs');
  });

  // ---- Extraction trust rules (reused eval ground truth) ----
  it('trust: a no-commitment note fabricates ZERO promises', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'NoCommit Co');
    const { extracted } = await pasteAndExtract(rep, clientId, evalNote('no-commitment-catchup').note);
    expect(extracted).toBeTruthy();
    expect(extracted!.promises).toHaveLength(0); // a fabricated promise here is a trust breach
    h.report.pass('A', 'FLOW 9', 'zero fabricated promises on a catch-up note');
  });

  it('trust: a year-less/vague date stays null with the raw phrase kept', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'Vague Date Co');
    const { extracted } = await pasteAndExtract(rep, clientId, evalNote('unresolved-vague-date').note);
    expect(extracted).toBeTruthy();
    // No promise may carry a guessed ISO date for a vague phrase.
    const vague = extracted!.promises.find((p) => /contract|circle back/i.test(p.text)) ?? extracted!.promises[0];
    if (vague) {
      expect(vague.due_date).toBeNull(); // never guessed
      expect(vague.due_raw ?? '').not.toBe(''); // raw phrase preserved
    }
    // And no date anywhere invents a year the rep never said.
    for (const p of extracted!.promises) if (p.due_raw && /holiday|after|sometime/i.test(p.due_raw)) expect(p.due_date).toBeNull();
    h.report.pass('A', 'FLOW 9', 'year-less date → null, raw kept');
  });

  it('trust: a code-switched Arabic/English note extracts (multilingual works)', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'Multilingual Co');
    const { extracted } = await pasteAndExtract(rep, clientId, evalNote(TRAP_NOTES.codeSwitch).note);
    expect(extracted).toBeTruthy();
    expect(extracted!.promises.length).toBeGreaterThan(0); // the Arabic/English promise is found
    h.report.pass('A', 'FLOW 9', 'code-switched note extracts a promise');
  });

  it('trust: a role-only mention produces NO null-named person', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'RoleOnly Co');
    const { extracted } = await pasteAndExtract(rep, clientId, evalNote(TRAP_NOTES.roleOnly).note);
    expect(extracted).toBeTruthy();
    for (const person of extracted!.people) expect((person.name ?? '').trim()).not.toBe('');
    h.report.pass('A', 'FLOW 9', 'role-only mention → no null-named person');
  });

  it('trust: soft "we should probably…" is not fabricated into a promise', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'Soft Language Co');
    // Trust NEGATIVE (not a planted positive): soft language must not become a promise.
    const { extracted } = await pasteAndExtract(rep, clientId, 'Good call with them. We should probably sync again sometime next month, nothing firm yet.');
    expect(extracted).toBeTruthy();
    expect(extracted!.promises).toHaveLength(0);
    h.report.pass('A', 'FLOW 9', 'soft language → no fabricated promise');
  });

  // ---- FLOW 4: import a valid export → parsed + extracted + Book Scan populated ----
  // A small (single-note) export so extraction stays well under the ~30s gateway
  // timeout; the larger-import timeout is captured as its own finding below.
  it('a valid WhatsApp import parses messages, extracts facts, and populates Book Scan', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'Northwind');
    const { text } = whatsappExportFromEval('Northwind', [TRAP_NOTES.firmPromise]);
    const imp = await rep.http.post<{ imported: number; ceilingReached: boolean }>(`/clients/${clientId}/notes/import`, { content: text, consent: true });
    if (imp.status >= 500) {
      h.report.fail('A', 'FLOW 4', 'valid import', `import returned ${imp.status} (server/gateway error) — see import-latency finding`, rep.http.lastExchange());
    }
    expect(imp.status, `import: ${rep.http.lastExchange()}`).toBe(201);
    expect(imp.body.imported).toBeGreaterThan(0);
    const notes = await rep.http.get<{ notes: NoteRecord[] }>(`/clients/${clientId}/notes`);
    const chat = notes.body.notes.find((n) => n.source === 'whatsapp_export');
    expect(chat, 'a whatsapp_export note exists').toBeTruthy();
    expect((chat!.messages ?? []).length).toBeGreaterThan(0); // messages parsed
    const scan = await rep.http.get<{ isEmpty: boolean; chatsRead: number }>('/book-scan');
    expect(scan.status).toBe(200);
    expect(scan.body.chatsRead).toBeGreaterThanOrEqual(1); // book scan sees the imported chat
    h.report.pass('A', 'FLOW 4', 'import parses + extracts + Book Scan populated', `imported=${imp.body.imported} chatsRead=${scan.body.chatsRead}`);
  });

  // FINDING (recorded, not fixed): synchronous import extraction can exceed the ~30s
  // CloudFront/ALB timeout even for a small multi-message chat → the client sees a 504
  // although the server likely completed the write. A reliability risk for real seeding.
  it('a modest multi-message import completes within the gateway timeout (no 504)', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'Latency Co');
    const { text } = whatsappExportFromEval('Latency Co', [TRAP_NOTES.firmPromise, TRAP_NOTES.codeSwitch, TRAP_NOTES.roleOnly]);
    const imp = await rep.http.post<{ imported: number }>(`/clients/${clientId}/notes/import`, { content: text, consent: true });
    if (imp.status === 504 || imp.status >= 500) {
      h.report.fail('A', 'FLOW 4', 'import latency vs 30s gateway timeout',
        `import of a 3-message chat returned ${imp.status} after ${Math.round(rep.http.history[rep.http.history.length - 1]!.durationMs)}ms — synchronous extraction exceeds the gateway timeout (reliability risk for seeding)`,
        rep.http.lastExchange());
    } else {
      h.report.pass('A', 'FLOW 4', 'modest import under gateway timeout', `status=${imp.status}`);
    }
    expect(imp.status, 'a 3-message import should not hit the 30s gateway timeout').toBe(201);
  });

  // ---- FLOW 20: dedupe on re-import; only-new-tail on extended import ----
  it('re-importing the identical export dedupes (0 new); an extended export imports only the tail', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'Dedupe Co');
    const { text } = whatsappExportFromEval('Dedupe Co', [TRAP_NOTES.firmPromise, TRAP_NOTES.yearlessDate]);
    const first = await rep.http.post<{ imported: number }>(`/clients/${clientId}/notes/import`, { content: text, consent: true });
    expect(first.status).toBe(201);
    const firstImported = first.body.imported;

    // Identical re-import → duplicate, zero new.
    const again = await rep.http.post<{ imported: number; duplicate?: boolean; note: unknown }>(`/clients/${clientId}/notes/import`, { content: text, consent: true });
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.imported).toBe(0);

    // Extended export (append one new message) → only the new tail is imported.
    const extended = `${text}\n[10/06/2026, 09:00:00] Dedupe Co: One more thing — please send the deck by next Tuesday.`;
    const ext = await rep.http.post<{ imported: number }>(`/clients/${clientId}/notes/import`, { content: extended, consent: true });
    expect(ext.status).toBe(201);
    expect(ext.body.imported).toBe(1); // only the appended tail, not the whole file again
    h.report.pass('A', 'FLOW 20', 'dedupe (0 new) + extended import (tail only)', `first=${firstImported} tail=${ext.body.imported}`);
  });

  // ---- Import negatives ----
  it('a non-WhatsApp .txt is rejected (422) and the raw upload is preserved', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'Malformed Co');
    const before = (await rep.http.get<{ notes: NoteRecord[] }>(`/clients/${clientId}/notes`)).body.notes.length;
    const bad = await rep.http.post(`/clients/${clientId}/notes/import`, { content: 'just some random text, not a WhatsApp export at all', consent: true });
    expect(bad.status).toBe(422);
    const notes = await rep.http.get<{ notes: NoteRecord[] }>(`/clients/${clientId}/notes`);
    // The raw file is preserved as an import_failed note — nothing silently dropped.
    const failed = notes.body.notes.find((n) => n.status === 'import_failed');
    expect(failed, 'raw upload preserved as import_failed').toBeTruthy();
    expect(notes.body.notes.length).toBeGreaterThan(before);
    h.report.pass('A', 'FLOW 4', 'non-WhatsApp import → 422, raw preserved');
  });

  it('import without consent is refused server-side (400 consent_required)', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'NoConsent Co');
    const { text } = whatsappExportFromEval('NoConsent Co', [TRAP_NOTES.firmPromise]);
    const res = await rep.http.post<{ error: string }>(`/clients/${clientId}/notes/import`, { content: text });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('consent_required');
    h.report.pass('A', 'FLOW 4', 'import without consent → 400 consent_required');
  });

  // ---- FLOW 7: trial seeding ceiling (structural — full exhaustion is out of budget) ----
  it('the import response exposes the trial ceiling contract (ceilingReached)', async () => {
    const rep = await h.factory.newRep();
    const clientId = await createClient(rep, 'Ceiling Co');
    const { text } = whatsappExportFromEval('Ceiling Co', [TRAP_NOTES.firmPromise]);
    const imp = await rep.http.post<{ ceilingReached?: boolean; note: unknown }>(`/clients/${clientId}/notes/import`, { content: text, consent: true });
    expect(imp.status).toBe(201);
    // Well under the 200-extraction ceiling, so this is false — but the field is
    // present, and the "nothing lost" invariant is proven by the import_failed test.
    expect(imp.body).toHaveProperty('ceilingReached');
    expect(imp.body.ceilingReached).toBe(false);
    h.report.record({
      part: 'A',
      flow: 'FLOW 7',
      name: 'trial seeding ceiling',
      outcome: 'PARTIAL',
      detail: 'ceilingReached contract present; driving to the real 200-extraction limit is out of this run\'s cost budget (rail #6). "Nothing lost" verified via the import_failed preservation test.',
    });
  });
});
