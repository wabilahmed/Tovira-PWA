import type { TestDeps } from '../http/test-deps.js';
import { promiseDedupeKey } from '../services/facts/promise-identity.js';

const DAY = 86_400_000;

export interface PersonIds { clientId: string; noteId: string; replyNoteId: string; promiseId: string; captureId: string; itemId: string; matchId: string; shareId: string; meetingId: string }

/**
 * [P47 · guard] One person's full set of data, every word they said carrying `marker`: two messages in a client's chat,
 * the people entry, a personal fact and an unanswered question read from them, a promise and a key date, a
 * requirement, a meeting, a pointer, a held note that mentions them, an alert quoting them, an inventory suggestion
 * built on their requirement (shared and the client Won), and a going-quiet alert that reached the rep followed by
 * their reply. Seeded once for the restricted person and once for someone who is not, so a surface that shows the
 * second but not the first is a fixture gap the guard can see.
 */
export async function seedPerson(deps: TestDeps, u: string, p: { person: string; marker: string; clientName: string; base: string; token: string }): Promise<PersonIds> {
  const { person, marker: M } = p;
  const c = await deps.clients.create(u, p.clientName);
  const S1 = `${M} here, looking for a 4BR villa in Mirdif, budget around 3M`;
  const S2 = `${M} will send the passport copy by 01/02/2026`;
  const note = await deps.notes.create(u, {
    clientId: c.id, source: 'whatsapp_export', audioKey: null, status: 'extracted',
    rawText: `${person}: ${S1}\n${person}: ${S2}\nRep: noted`,
    messages: [
      { sentAt: '2026-01-01T10:00', sender: person, body: S1, media: false, role: 'client' },
      { sentAt: '2026-01-02T10:00', sender: person, body: S2, media: false, role: 'client' },
      { sentAt: '2026-01-03T10:05', sender: 'Rep', body: 'noted', media: false, role: 'rep' },
    ],
  } as never);
  await deps.notes.update(u, note.id, { extracted: {
    summary: `${person} wants a villa.`, promises: [], requirements: [],
    people: [{ name: person, role: `${M} buyer`, reports_to: null, decision_role: 'decision_maker', notes: M }],
    personal_facts: [{ subject: person, fact: `${M} collects watches`, category: 'background', source_span: S1, source_message_at: '2026-01-01T10:00' }],
    key_dates: [], concerns: [], next_steps: [], meeting: null, unanswered_questions: [{ sender: person, question: `${M} can you send the floor plan?` }],
  } as never, embedding: [1, 0, 0] });
  await deps.facts.saveExtraction(u, { noteId: note.id, clientId: c.id, promises: [
    // overdue by days, not months (a promise long overdue is stale and off the active lists)
    { text: `Send the ${M} passport copy`, owner: 'client', due_date: new Date(Date.now() - 10 * DAY).toISOString().slice(0, 10), due_raw: 'by Sunday', confidence: 'high', source_span: S2, source_message_at: '2026-01-02T10:00' },
    // waiting for the rep (Needs your answer): a guess to confirm, and a date to confirm
    { text: `Maybe send the ${M} bank letter`, owner: 'client', due_date: null, due_raw: null, confidence: 'low', source_span: S2, source_message_at: '2026-01-02T10:00' },
    { text: `Share the ${M} floor plan`, owner: 'rep', due_date: null, due_raw: 'after the holidays', confidence: 'high', source_span: S1, source_message_at: '2026-01-01T10:00' },
  ], keyDates: [{ description: `${M} lease ends`, date: '2026-12-01', date_raw: '01/12/2026', type: 'deadline', source_span: S2, source_message_at: '2026-01-02T10:00' }] });
  const [req] = await deps.requirements.saveForNote(u, note.id, c.id, [{ text: `4BR villa in ${M} Gardens`, requirementRaw: S1, statedOn: '2026-01-01', confidence: 'high', embedding: null }]);
  // [P50-2] a "same person?" card: a name in their chat that shares a word with the client, its receipt one of their messages
  await deps.samePerson.noteLookalikes(u, c.id, note.id, { people: [{ name: `${person} ${p.clientName.split(' ')[0]}`, source_span: S1, source_message_at: '2026-01-01T10:00' }] });
  const meeting = await deps.meetings.create(u, { clientId: c.id, datetime: '2026-02-10T11:00:00.000Z', datetimeRaw: `${M} viewing`, title: null, confirmed: true, noteId: note.id, sourceSpan: S1, sourceMessageAt: '2026-01-01T10:00', captureAt: '2026-01-03' });
  await deps.clientPointers!.save(u, c.id, { pointers: [{ section: 'relationship', text: `${person} (${M}) pushes on price`, receipts: [] }], retrospectiveDisclosure: null }, Date.now());
  const held = await deps.askCapture!.capture(u, c.id, `${person} raised his budget to 3.2M`, '2026-01-04');
  const promise = (await deps.facts.listPromisesByUser(u)).find((x) => x.clientId === c.id && x.text.startsWith('Send the'))!;
  // a pasted chat still waiting for extraction (Needs your answer / pending notes)
  await deps.notes.create(u, { clientId: c.id, source: 'paste', rawText: `${person}: ${M} can we move the viewing to Friday?`, audioKey: null, status: 'pending_extraction' } as never);
  // "looks like you sent it": a later message of theirs says the promise was delivered
  await deps.keptSuggestionRepo.createIfAbsent(u, { clientId: c.id, noteId: note.id, promiseKey: promiseDedupeKey('client', `Send the ${M} passport copy`), promiseOwner: 'client', promiseText: `Send the ${M} passport copy`, promiseSpan: S2, promiseAt: '2026-01-02T10:00', deliveryAt: '2026-01-03T09:00', deliveryBody: `${M} here is the passport copy` });
  await deps.notifications.createIfAbsent(u, { type: 'overdue_promise', dedupeKey: `pre-window-${c.id}`, clientId: c.id, title: 'Overdue', body: `${person}: ${M} passport copy` });
  // an inventory suggestion built on their requirement, shared from the suggestion, and that deal Won. The Won is on a
  // SECOND client (their company's other account) so the main client stays open: Find, risk and the client rows skip a
  // closed client, and a guard fixture that closes it sees nothing there.
  const won = await deps.clients.create(u, `${p.clientName} (second account)`);
  const wonNote = await deps.notes.create(u, { clientId: won.id, source: 'whatsapp_export', rawText: 'chat', audioKey: null, status: 'extracted', messages: [{ sentAt: '2026-01-05T10:00', sender: person, body: `${M} we want the same for our second office`, media: false, role: 'client' }] } as never);
  const [wonReq] = await deps.requirements.saveForNote(u, wonNote.id, won.id, [{ text: `${M} villa for the second office`, requirementRaw: `${M} we want the same for our second office`, statedOn: '2026-01-05', confidence: 'high', embedding: null }]);
  const item = await deps.inventoryRepo.create(u, { title: `Villa list for ${p.clientName}`, description: 'villas', quantity: null, embedding: null } as never);
  const match = await deps.inventoryMatches.upsert(u, { requirementId: wonReq!.id, itemId: item.id, clientId: won.id, similarity: 1, confidence: 'strong' });
  const share = await deps.inventoryRepo.createShare(u, { itemId: item.id, clientId: won.id, outcomeSetBy: 'confirmed_suggestion', matchId: match.id });
  // a second, still-open suggestion on the same requirement, so Inventory and Today still show one
  const item2 = await deps.inventoryRepo.create(u, { title: `Townhouse list for ${p.clientName}`, description: 'townhouses', quantity: null, embedding: null } as never);
  const match2 = await deps.inventoryMatches.upsert(u, { requirementId: req!.id, itemId: item2.id, clientId: c.id, similarity: 1, confidence: 'strong' });
  await deps.clients.setOutcome(u, won.id, 'won', 'rep', Date.now() + 5_000); // after the share (the in-memory share clock can run a few ms ahead)
  await deps.onOutcomeChanged!(u, won.id);
  // going quiet: the alert reached the rep, then they wrote back
  await deps.clients.setLastTouched(u, c.id, Date.now() - 45 * DAY);
  await deps.winBack!.recordShown(u, [c.id], Date.now() - 2 * DAY);
  const reply = await deps.notes.create(u, { clientId: c.id, source: 'whatsapp_export', rawText: 'chat', audioKey: null, status: 'extracted', messages: [{ sentAt: new Date(Date.now() - DAY).toISOString().slice(0, 16), sender: person, body: `${M} back from travel`, media: false, role: 'client' }] } as never);
  await deps.clients.setLastTouched(u, c.id, Date.now() - 45 * DAY); // still quiet for Today, Find and risk
  return { clientId: c.id, noteId: note.id, replyNoteId: reply.id, promiseId: promise.id, captureId: held!.noteId, itemId: item2.id, matchId: match2.id, shareId: share.id, meetingId: meeting.id };
}
