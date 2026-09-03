import { describe, it, expect } from 'vitest';
import { NudgeSignalsProvider } from './nudge-signals.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import type { ExtractedPromise } from '../extraction/types.js';

const NOW = Date.parse('2026-07-09T09:00:00Z'); // 13:00 Dubai
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function harness() {
  const clients = new InMemoryClientRepository();
  const facts = new InMemoryFactsRepository();
  const notes = new InMemoryNoteRepository();
  const meetings = new InMemoryMeetingRepository();
  const provider = new NudgeSignalsProvider({ clients, facts, notes, timezoneFor: async () => 'Asia/Dubai', coldThresholdDays: 30 });
  async function meetingFor(clientId: string) {
    return meetings.create('u', { clientId, datetime: new Date(NOW + 2 * HOUR).toISOString(), datetimeRaw: '3pm', title: null, confirmed: true });
  }
  const prom = (over: Partial<ExtractedPromise>): ExtractedPromise => ({ text: 'do the thing', owner: 'rep', due_date: null, due_raw: null, confidence: 'high', ...over });
  return { clients, facts, notes, provider, meetingFor, prom };
}

describe('[NUDGE-CONTENT] NudgeSignalsProvider selects the top signal in priority order', () => {
  it('an open rep promise wins over a question and a cooling signal, and picks the most overdue', async () => {
    const h = harness();
    const c = await h.clients.create('u', 'Meridian');
    (c as { lastTouchedAt: number }).lastTouchedAt = NOW - 40 * DAY; // also cooling
    await h.facts.saveExtraction('u', { noteId: 'n1', clientId: c.id, promises: [
      h.prom({ text: 'send the revised quote', due_date: '2026-07-05' }), // overdue → most actionable
      h.prom({ text: 'book the second viewing', due_date: '2026-07-20' }),
    ] });
    const note = await h.notes.create('u', { clientId: c.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'ready' });
    await h.notes.update('u', note.id, { extracted: { unanswered_questions: [{ question: 'still deciding?', sentAt: null, sender: 'client' }] } });

    const s = await h.provider.signalsFor('u', await h.meetingFor(c.id), NOW);
    expect(s.topPromise).toBe('send the revised quote');
    expect(s.topQuestion).toBeUndefined();
    expect(s.silentDays).toBe(0);
    expect(s.clientName).toBe('Meridian');
    expect(s.whenLabel).toBe('today at 3:00 PM'); // NOW+2h = 15:00 Dubai, same Dubai day
  });

  it('falls to an unanswered question when there is no open promise', async () => {
    const h = harness();
    const c = await h.clients.create('u', 'Meridian');
    (c as { lastTouchedAt: number }).lastTouchedAt = NOW - 40 * DAY; // cooling present but lower priority
    const note = await h.notes.create('u', { clientId: c.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'ready' });
    await h.notes.update('u', note.id, { extracted: { unanswered_questions: [{ question: 'are they still deciding this month', sentAt: null, sender: 'client' }] } });

    const s = await h.provider.signalsFor('u', await h.meetingFor(c.id), NOW);
    expect(s.topPromise).toBeUndefined();
    expect(s.topQuestion).toBe('are they still deciding this month');
    expect(s.silentDays).toBe(0);
  });

  it('falls to the cooling signal when there is neither promise nor question', async () => {
    const h = harness();
    const c = await h.clients.create('u', 'Falcon Group');
    (c as { lastTouchedAt: number }).lastTouchedAt = NOW - 40 * DAY;
    const s = await h.provider.signalsFor('u', await h.meetingFor(c.id), NOW);
    expect(s.topPromise).toBeUndefined();
    expect(s.topQuestion).toBeUndefined();
    expect(s.silentDays).toBe(40);
  });

  it('a well-tended client yields no item at all (thin nudge downstream)', async () => {
    const h = harness();
    const c = await h.clients.create('u', 'Warm Corp'); // just touched, no promises, no questions
    const s = await h.provider.signalsFor('u', await h.meetingFor(c.id), NOW);
    expect(s.topPromise).toBeUndefined();
    expect(s.topQuestion).toBeUndefined();
    expect(s.silentDays).toBe(0);
  });
});
