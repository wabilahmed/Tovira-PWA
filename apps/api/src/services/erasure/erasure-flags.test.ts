import { describe, it, expect } from 'vitest';
import { ErasureService } from './erasure-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryErasureAuditRepository } from '../../adapters/erasure/in-memory-erasure-audit-repository.js';

/**
 * [ERASURE-FLAGS] On real data a fact ABOUT the requester lands in free text (key_dates / next_steps /
 * concerns), which auto-deletion keeps as a "mention" — the live-UAT under-erasure finding. The operator
 * reviews keptMentions and FLAGS the ones about her; commit deletes the flagged element WHOLE — never
 * edited, never a sibling, never another account's.
 */
function make() {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const extractionLog = new InMemoryExtractionLogRepository();
  const audit = new InMemoryErasureAuditRepository();
  const svc = new ErasureService({ clients, notes, extractionLog, audit });
  return { clients, notes, extractionLog, audit, svc };
}

// A note where the requester (Zelda) appears as a person AND her facts landed in free text: a key_date
// and a next_step that are ABOUT her, plus a sibling key_date/next_step about someone else that must
// survive byte-identical.
async function seed(clients: InMemoryClientRepository, notes: InMemoryNoteRepository, userId: string) {
  const c = await clients.create(userId, 'Marina Estates'); // allNotes iterates clients, so the client must exist
  const note = await notes.create(userId, { clientId: c.id, source: 'whatsapp_export', audioKey: null, status: 'extracted', rawText: 'x', messages: [] });
  await notes.update(userId, note.id, {
    extracted: {
      summary: 'Zelda is ready to proceed; Marlow will call.',
      people: [{ name: 'Zelda', role: null, reports_to: null, decision_role: 'unknown', notes: null }],
      personal_facts: [],
      key_dates: [
        { description: "Zelda's readiness to proceed with the purchase", date: null, date_raw: 'this month', type: 'deadline', source_span: "I'm ready", source_message_at: null },
        { description: "Marlow's birthday party", date: null, date_raw: 'next week', type: 'other', source_span: 'party', source_message_at: null },
      ],
      next_steps: ['Send Zelda a copy of the plan', 'Call Marlow on Tuesday'],
      concerns: [], promises: [], meeting: null, unanswered_questions: [],
    },
  });
  return note;
}

const kdOf = async (notes: InMemoryNoteRepository, u: string, id: string) =>
  ((await notes.findByIdForUser(u, id))!.extracted as { key_dates: Array<{ description: string }> }).key_dates;
const nsOf = async (notes: InMemoryNoteRepository, u: string, id: string) =>
  ((await notes.findByIdForUser(u, id))!.extracted as { next_steps: string[] }).next_steps;

describe('[ERASURE-FLAGS] operator flags delete a free-text fact-about, whole', () => {
  it('preview gives every keptMention a stable id (note:store:index)', async () => {
    const { clients, notes, svc } = make();
    const n = await seed(clients, notes, 'u');
    const plan = await svc.preview('u', ['Zelda']);
    const byStore = Object.fromEntries(plan.keptMentions.map((m) => [m.store, m.id]));
    expect(byStore.key_date).toBe(`${n.id}:key_date:0`); // the Zelda key_date, at index 0
    expect(byStore.next_step).toBe(`${n.id}:next_step:0`); // "Send Zelda a copy", index 0
    expect(byStore.summary).toBe(`${n.id}:summary:0`);
  });

  it('a flagged key_date is removed; its unflagged sibling survives BYTE-IDENTICAL', async () => {
    const { clients, notes, svc } = make();
    const n = await seed(clients, notes, 'u');
    const before = await kdOf(notes, 'u', n.id);
    await svc.commit('u', ['Zelda'], { flaggedMentionIds: [`${n.id}:key_date:0`] });
    const after = await kdOf(notes, 'u', n.id);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(before[1]); // Marlow's birthday, entire object unchanged
    expect(after.some((d) => /readiness/.test(d.description))).toBe(false); // the flagged one is gone
  });

  it('a flag is a DELETION, never an edit — only presence changes, no surviving field is altered', async () => {
    const { clients, notes, svc } = make();
    const n = await seed(clients, notes, 'u');
    const beforeNs = await nsOf(notes, 'u', n.id);
    const beforeKd = await kdOf(notes, 'u', n.id);
    await svc.commit('u', ['Zelda'], { flaggedMentionIds: [`${n.id}:next_step:0`] }); // flag "Send Zelda a copy" only
    const afterNs = await nsOf(notes, 'u', n.id);
    expect(afterNs).toEqual([beforeNs[1]!]); // exactly the survivor, UNEDITED ("Call Marlow on Tuesday")
    // key_dates were NOT flagged → both survive byte-identical (no collateral edit to an unflagged store)
    expect(await kdOf(notes, 'u', n.id)).toEqual(beforeKd);
  });

  it('an UNFLAGGED mention survives byte-identical (nothing flagged → free text untouched)', async () => {
    const { clients, notes, svc } = make();
    const n = await seed(clients, notes, 'u');
    const before = (await notes.findByIdForUser('u', n.id))!.extracted;
    await svc.commit('u', ['Zelda']); // no flags
    const after = (await notes.findByIdForUser('u', n.id))!.extracted as Record<string, unknown>;
    expect(after.key_dates).toEqual((before as Record<string, unknown>).key_dates);
    expect(after.next_steps).toEqual((before as Record<string, unknown>).next_steps);
    expect(after.summary).toEqual((before as Record<string, unknown>).summary);
  });

  it('the audit counts flagged deletions per store, no content', async () => {
    const { clients, notes, audit, svc } = make();
    const n = await seed(clients, notes, 'u');
    await svc.commit('u', ['Zelda'], { flaggedMentionIds: [`${n.id}:key_date:0`, `${n.id}:next_step:0`] });
    const rec = (await audit.listByUser('u'))[0]!;
    const cat = Object.fromEntries(rec.categories.map((c) => [c.category, c.deleted]));
    expect(cat.key_dates).toBe(1);
    expect(cat.next_steps).toBe(1);
    expect(JSON.stringify(rec)).not.toMatch(/readiness|Marlow|copy of the plan/); // counts only, no content
  });

  it("flags from one account CANNOT target another account's facts", async () => {
    const { clients, notes, svc } = make();
    const a = await seed(clients, notes, 'ua');
    const b = await seed(clients, notes, 'ub');
    // Run ua's erasure but pass ub's key_date id as a flag — it must be ignored (ua's note != ub's note).
    await svc.commit('ua', ['Zelda'], { flaggedMentionIds: [`${b.id}:key_date:0`] });
    expect(await kdOf(notes, 'ua', a.id)).toHaveLength(2); // ua's key_dates untouched (its own id wasn't flagged)
    expect(await kdOf(notes, 'ub', b.id)).toHaveLength(2); // ub's note never even scanned by ua's commit
  });
});
