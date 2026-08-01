import { describe, it, expect } from 'vitest';
import { MondayDigestService } from './monday-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';

const NOW = Date.parse('2026-08-03T09:00:00Z'); // a Monday
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function make() {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const facts = new InMemoryFactsRepository();
  const notifications = new InMemoryNotificationRepository();
  const svc = new MondayDigestService(clients, notes, facts, notifications, 30);
  return { clients, notes, facts, notifications, svc };
}

describe('MondayDigestService (P3-8)', () => {
  it('digests exactly this week\'s due promises and cooling clients', async () => {
    const { clients, facts, svc } = make();
    const c = await clients.create('u', 'Acme');
    const cold = await clients.create('u', 'Quiet Co');
    (cold as { lastTouchedAt: number }).lastTouchedAt = NOW - 40 * DAY; // cooling
    await facts.saveExtraction('u', {
      noteId: 'n', clientId: c.id,
      promises: [
        { text: 'send quote', owner: 'rep', due_date: iso(NOW + 1 * DAY), due_raw: null, confidence: 'high' },
        { text: 'call finance', owner: 'rep', due_date: iso(NOW + 4 * DAY), due_raw: null, confidence: 'high' },
        { text: 'next month thing', owner: 'rep', due_date: iso(NOW + 40 * DAY), due_raw: null, confidence: 'high' }, // out of week
      ],
    });
    const digest = await svc.build('u', NOW);
    expect(digest.promisesDue.map((p) => p.text).sort()).toEqual(['call finance', 'send quote']);
    expect(digest.coolingClients).toHaveLength(1);
    expect(digest.isLight).toBe(false);
  });

  // NEVER PADDED: a clear week is stated honestly, not filled with stale items.
  it('returns an honest light digest for a clear week', async () => {
    const { clients, svc } = make();
    await clients.create('u', 'Warm Co'); // just touched, nothing due
    const digest = await svc.build('u', NOW);
    expect(digest.isLight).toBe(true);
    expect(digest.promisesDue).toEqual([]);
    expect(digest.coolingClients).toEqual([]);
  });

  it('surfaces unanswered questions and upcoming dates', async () => {
    const { clients, notes, facts, svc } = make();
    const c = await clients.create('u', 'Acme');
    const note = await notes.create('u', { clientId: c.id, source: 'whatsapp_export', rawText: 't', audioKey: null, status: 'extracted', messages: [] });
    await notes.update('u', note.id, { extracted: { unanswered_questions: [{ question: 'bulk pricing?', sentAt: '2026-07-01T10:00:00', sender: 'Acme' }] } });
    await facts.saveExtraction('u', { noteId: 'n', clientId: c.id, promises: [], keyDates: [{ description: 'launch', date: iso(NOW + 2 * DAY), date_raw: null, type: 'launch' }] });
    const digest = await svc.build('u', NOW);
    expect(digest.unansweredQuestions[0]!.question).toBe('bulk pricing?');
    expect(digest.upcomingDates[0]!.description).toBe('launch');
  });

  // IDEMPOTENT: re-running the same week does not send a second digest.
  it('sends the weekly notification only once per week', async () => {
    const { clients, svc, notifications } = make();
    await clients.create('u', 'Acme');
    expect(await svc.notifyMonday('u', NOW)).toBe(true);
    expect(await svc.notifyMonday('u', NOW + DAY)).toBe(false); // same week → no second digest
    expect(await notifications.listByUser('u')).toHaveLength(1);
  });

  it('never includes another rep\'s data', async () => {
    const { clients, facts, svc } = make();
    const c = await clients.create('a', 'A Co');
    await facts.saveExtraction('a', { noteId: 'n', clientId: c.id, promises: [{ text: 'a secret', owner: 'rep', due_date: iso(NOW + 1 * DAY), due_raw: null, confidence: 'high' }] });
    const digest = await svc.build('b', NOW);
    expect(digest.promisesDue).toEqual([]);
    expect(digest.isLight).toBe(true);
  });
});
