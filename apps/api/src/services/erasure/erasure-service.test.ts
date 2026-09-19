import { describe, it, expect } from 'vitest';
import { ErasureService } from './erasure-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryErasureAuditRepository } from '../../adapters/erasure/in-memory-erasure-audit-repository.js';

/**
 * [ERASURE Task 2] Delete facts ABOUT the requester (structured who-field = requester); keep facts
 * that merely MENTION them, receipts byte-identical.
 */

function make() {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const extractionLog = new InMemoryExtractionLogRepository();
  const audit = new InMemoryErasureAuditRepository();
  const svc = new ErasureService({ clients, notes, extractionLog, audit });
  return { clients, notes, extractionLog, audit, svc };
}

// A note whose extraction has: a personal_fact ABOUT Khalid, a person entry for Khalid, and a
// promise that merely MENTIONS Khalid (its receipt quotes a message naming him).
const RECEIPT = "Khalid wants to see it too — book the viewing"; // verbatim quote naming the requester
async function seedNote(notes: InMemoryNoteRepository, userId: string, clientId: string) {
  const note = await notes.create(userId, {
    clientId, source: 'whatsapp_export', audioKey: null, status: 'extracted',
    rawText: '[t] Khalid: I have five million ready\n[t] Layla: book the viewing',
    messages: [
      { sentAt: '2026-01-01T10:00:00', sender: 'Khalid', body: 'I have five million ready', media: false, role: 'unknown' },
      { sentAt: '2026-01-01T10:01:00', sender: 'Layla', body: 'book the viewing', media: false, role: 'client' },
    ],
  });
  await notes.update(userId, note.id, {
    extracted: {
      summary: 'Layla wants the viewing; Khalid is interested too.',
      people: [
        { name: 'Khalid', role: null, reports_to: null, decision_role: 'unknown', notes: null },
        { name: 'Layla', role: null, reports_to: null, decision_role: 'unknown', notes: null },
      ],
      personal_facts: [
        { subject: 'Khalid', fact: 'has five million ready', category: 'background', source_span: 'I have five million ready', source_message_at: null },
      ],
      promises: [
        { text: 'Book the viewing (Khalid wants to see it too)', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', source_span: RECEIPT, source_message_at: null },
      ],
      key_dates: [], concerns: [], next_steps: [], meeting: null, unanswered_questions: [],
    },
  });
  return note;
}

describe('[ERASURE Task 2] delete about, keep mention', () => {
  it('deletes a fact ABOUT the requester (personal_fact whose subject is Khalid)', async () => {
    const { clients, notes, svc } = make();
    const c = await clients.create('u', 'Marina Estates');
    const n = await seedNote(notes, 'u', c.id);
    await svc.commit('u', ['Khalid']);
    const after = await notes.findByIdForUser('u', n.id);
    const pf = (after!.extracted as { personal_facts: unknown[] }).personal_facts;
    expect(pf).toHaveLength(0); // the "Khalid has five million" fact is gone
  });

  it('a fact merely MENTIONING the requester survives, receipt BYTE-IDENTICAL', async () => {
    const { clients, notes, svc } = make();
    const c = await clients.create('u', 'Marina Estates');
    const n = await seedNote(notes, 'u', c.id);
    await svc.commit('u', ['Khalid']);
    const after = await notes.findByIdForUser('u', n.id);
    const promises = (after!.extracted as { promises: Array<{ text: string; source_span: string }> }).promises;
    expect(promises).toHaveLength(1); // the mentioning promise survives
    expect(promises[0]!.source_span).toBe(RECEIPT); // quote untouched, exactly as written
  });

  it("deletes the requester's people entry (a fact about them)", async () => {
    const { clients, notes, svc } = make();
    const c = await clients.create('u', 'Marina Estates');
    const n = await seedNote(notes, 'u', c.id);
    await svc.commit('u', ['Khalid']);
    const people = (await notes.findByIdForUser('u', n.id))!.extracted as { people: Array<{ name: string }> };
    expect(people.people.map((p) => p.name)).toEqual(['Layla']); // Khalid gone, Layla kept
  });

  it("deletes the requester's OWN messages, keeps others; a dangling name reference does not error", async () => {
    const { clients, notes, svc } = make();
    const c = await clients.create('u', 'Marina Estates');
    const n = await seedNote(notes, 'u', c.id);
    await svc.commit('u', ['Khalid']);
    const after = await notes.findByIdForUser('u', n.id);
    expect(after!.messages!.map((m) => m.sender)).toEqual(['Layla']); // Khalid's message gone
    // The kept promise still references "Khalid" as text — a dangling reference. Not an error.
    const promises = (after!.extracted as { promises: unknown[] }).promises;
    expect(promises).toHaveLength(1);
  });

  it("the rep's OTHER clients are entirely unaffected", async () => {
    const { clients, notes, svc } = make();
    const c1 = await clients.create('u', 'Marina Estates');
    const c2 = await clients.create('u', 'Other Co');
    await seedNote(notes, 'u', c1.id);
    const other = await seedNote(notes, 'u', c2.id); // also mentions Khalid, but this is a different client's note
    await svc.commit('u', ['Khalid']);
    // Other Co's note also had a Khalid personal_fact (same seed) — erasure is account-wide by design
    // (a third party spans clients), so it IS removed there too; but the CLIENT record + Layla survive.
    const oc = await clients.findByIdForUser('u', c2.id);
    expect(oc!.name).toBe('Other Co'); // client record intact
    const people = (await notes.findByIdForUser('u', other.id))!.extracted as { people: Array<{ name: string }> };
    expect(people.people.map((p) => p.name)).toEqual(['Layla']);
  });

  it('CROSS-ACCOUNT: erasing in one account never touches another', async () => {
    const { clients, notes, svc } = make();
    const ca = await clients.create('a', 'A Co');
    const cb = await clients.create('b', 'B Co');
    await seedNote(notes, 'a', ca.id);
    const bNote = await seedNote(notes, 'b', cb.id);
    await svc.commit('a', ['Khalid']);
    const bPeople = (await notes.findByIdForUser('b', bNote.id))!.extracted as { people: Array<{ name: string }> };
    expect(bPeople.people.map((p) => p.name).sort()).toEqual(['Khalid', 'Layla']); // account b untouched
  });

  it('records an audit (categories + counts, no erased content) and previews before committing', async () => {
    const { clients, notes, audit, svc } = make();
    const c = await clients.create('u', 'Marina Estates');
    await seedNote(notes, 'u', c.id);
    const plan = await svc.preview('u', ['Khalid']);
    expect(plan.autoDelete.some((i) => i.store === 'personal_facts')).toBe(true);
    expect(plan.autoDelete.some((i) => i.store === 'people')).toBe(true);
    expect(plan.keptMentions.some((m) => m.store === 'promise')).toBe(true); // mention listed as kept
    await svc.commit('u', ['Khalid']);
    const [rec] = await audit.listByUser('u');
    expect(rec!.outcome).toBe('committed');
    expect(rec!.categories.find((c2) => c2.category === 'people')!.deleted).toBe(1);
    expect(JSON.stringify(rec)).not.toContain('five million'); // no erased content in the audit
  });
});
