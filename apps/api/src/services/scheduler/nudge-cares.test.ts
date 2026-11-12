import { describe, it, expect } from 'vitest';
import { NudgeSignalsProvider } from './nudge-signals.js';
import { composeNudgeContent } from './nudge-content.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';

/**
 * [P69 · owner] The pre-meeting reminder leads with what the client said they care about ("Cares about: Loves the
 * beach…"), then the one actionable item (an open promise, a question, going quiet). Nothing on file → as before.
 */
const NOW = Date.parse('2026-07-09T09:00:00Z');
const HOUR = 3_600_000;

async function setup(personalFacts: unknown[]) {
  const clients = new InMemoryClientRepository();
  const facts = new InMemoryFactsRepository();
  const notes = new InMemoryNoteRepository();
  const meetings = new InMemoryMeetingRepository();
  const provider = new NudgeSignalsProvider({ clients, facts, notes, timezoneFor: async () => 'Asia/Dubai', coldThresholdDays: 30 });
  const c = await clients.create('u', 'Layla Haddad');
  await facts.saveExtraction('u', { noteId: 'n1', clientId: c.id, promises: [{ text: 'send the floor plans', owner: 'rep', due_date: null, due_raw: null, confidence: 'high' }] });
  const note = await notes.create('u', { clientId: c.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'ready' });
  await notes.update('u', note.id, { extracted: { personal_facts: personalFacts, concerns: [] } as never });
  const meeting = await meetings.create('u', { clientId: c.id, datetime: new Date(NOW + 2 * HOUR).toISOString(), datetimeRaw: '3pm', title: null, confirmed: true });
  return { provider, meeting };
}

describe('[P69] the pre-meeting reminder says what the client cares about', () => {
  it('"Cares about: …" comes before the open promise', async () => {
    const { provider, meeting } = await setup([{ subject: 'Layla', fact: 'Loves the beach, goes every morning before work', category: 'hobby', source_span: 'I love the beach', source_message_at: '2026-07-01T10:00' }]);
    const n = composeNudgeContent(await provider.signalsFor('u', meeting, NOW));
    expect(n.body).toBe('today at 3:00 PM · Cares about: Loves the beach, goes every morning before work · Open promise: send the floor plans');
  });

  it('nothing they care about on file: the reminder is unchanged', async () => {
    const { provider, meeting } = await setup([]);
    const n = composeNudgeContent(await provider.signalsFor('u', meeting, NOW));
    expect(n.body).toBe('today at 3:00 PM · Open promise: send the floor plans');
  });

  it('a health fact is never the line', async () => {
    const { provider, meeting } = await setup([{ subject: 'Layla', fact: 'Recovering from knee surgery', category: 'health', source_span: 'my knee', source_message_at: null }]);
    expect(composeNudgeContent(await provider.signalsFor('u', meeting, NOW)).body).not.toMatch(/knee/);
  });
});
