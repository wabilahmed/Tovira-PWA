import { describe, it, expect } from 'vitest';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { restrictionForNames } from './restriction.js';
import { alertSourceId, withheldFactIds } from './surface-filter.js';

/**
 * [P86 · found by the P47 erasure guard, 25 Nov] An alert written BEFORE an erasure window opened can quote the
 * restricted person without naming them: "<their words> lease ends: 2026-12-01" is a date reminder built from a key
 * date they stated. The notifications route withheld a pre-window alert only when its text NAMED the person, so this one
 * showed. (The guard caught it only because its fixture date entered the 7-day reminder window this week.) The route
 * now also withholds an alert whose source fact (the promise, key date or meeting its dedupe key names) is one the
 * restricted views withhold. These tests pin that without depending on today's date.
 */
async function book() {
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const meetings = new InMemoryMeetingRepository();
  const clients = { listByUser: async () => [{ id: 'c1', name: 'Marina Estates' }] };
  const said = (who: string, body: string) => ({ sentAt: '2026-01-02T10:00', sender: who, body, media: false, role: 'client' as const });
  const note = await notes.create('u1', { clientId: 'c1', source: 'whatsapp_export', rawText: null, audioKey: null, status: 'extracted', messages: [
    said('Khalid', 'my lease ends on 01/12/2026, I will send the passport copy'),
    said('Sara', 'the viewing on Friday works, I will bring the deposit'),
  ] });
  await facts.saveExtraction('u1', { noteId: note.id, clientId: 'c1', promises: [
    { text: 'Send the passport copy', owner: 'client', due_date: '2026-11-20', due_raw: null, confidence: 'high', source_span: 'I will send the passport copy', source_message_at: '2026-01-02T10:00' },
    { text: 'Bring the deposit', owner: 'client', due_date: '2026-11-21', due_raw: null, confidence: 'high', source_span: 'I will bring the deposit', source_message_at: '2026-01-02T10:00' },
  ], keyDates: [
    { description: 'Lease ends', date: '2026-12-01', date_raw: '01/12/2026', type: 'deadline', source_span: 'my lease ends on 01/12/2026', source_message_at: '2026-01-02T10:00' },
    { description: 'Viewing', date: '2026-11-28', date_raw: 'Friday', type: 'other', source_span: 'the viewing on Friday works', source_message_at: '2026-01-02T10:00' },
  ] });
  const khalidMeeting = await meetings.create('u1', { clientId: 'c1', datetime: '2026-12-02T10:00:00.000Z', datetimeRaw: 'lease handover', title: null, confirmed: true, noteId: note.id, sourceSpan: 'my lease ends on 01/12/2026', sourceMessageAt: '2026-01-02T10:00', captureAt: '2026-01-02' });
  const saraMeeting = await meetings.create('u1', { clientId: 'c1', datetime: '2026-11-28T10:00:00.000Z', datetimeRaw: 'Friday', title: null, confirmed: true, noteId: note.id, sourceSpan: 'the viewing on Friday works', sourceMessageAt: '2026-01-02T10:00', captureAt: '2026-01-02' });
  const ids = {
    khalidPromise: (await facts.listPromisesByUser('u1')).find((p) => p.text === 'Send the passport copy')!.id,
    saraPromise: (await facts.listPromisesByUser('u1')).find((p) => p.text === 'Bring the deposit')!.id,
    khalidDate: (await facts.listKeyDatesByUser('u1')).find((d) => d.description === 'Lease ends')!.id,
    saraDate: (await facts.listKeyDatesByUser('u1')).find((d) => d.description === 'Viewing')!.id,
    khalidMeeting: khalidMeeting.id,
    saraMeeting: saraMeeting.id,
  };
  return { notes, facts, meetings, clients, ids };
}

describe('[P86] a pre-window alert built from a restricted person\'s fact is withheld', () => {
  it('names the source fact of a fact alert, and none for an alert that is not built from one fact', () => {
    expect(alertSourceId('date:kd-1:2026-12-01')).toBe('kd-1');
    expect(alertSourceId('promise:p-1')).toBe('p-1');
    expect(alertSourceId('due_today:p-1:2026-11-25')).toBe('p-1');
    expect(alertSourceId('nudge:m-1')).toBe('m-1');
    expect(alertSourceId('cold:c-1')).toBeNull();
    expect(alertSourceId('monday:2026-11-23')).toBeNull();
    expect(alertSourceId('pre-window-c1')).toBeNull();
  });

  it('withholds the restricted person\'s promise, key date and meeting, and nothing of anyone else\'s', async () => {
    const { notes, facts, meetings, clients, ids } = await book();
    const restriction = { forUser: async () => restrictionForNames(['Khalid']) };
    const withheld = await withheldFactIds('u1', restriction, { facts, meetings }, notes, clients);
    expect(withheld.has(ids.khalidPromise)).toBe(true);
    expect(withheld.has(ids.khalidDate)).toBe(true);
    expect(withheld.has(ids.khalidMeeting)).toBe(true);
    expect(withheld.has(ids.saraPromise)).toBe(false);
    expect(withheld.has(ids.saraDate)).toBe(false);
    expect(withheld.has(ids.saraMeeting)).toBe(false);
  });

  it('withholds nothing when no restriction is open', async () => {
    const { notes, facts, meetings, clients } = await book();
    const none = { forUser: async () => restrictionForNames([]) };
    expect((await withheldFactIds('u1', none, { facts, meetings }, notes, clients)).size).toBe(0);
  });
});
