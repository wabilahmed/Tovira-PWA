import { describe, it, expect, vi } from 'vitest';
import { ImportCompletionService } from './import-completion-service.js';
import { NoteSweepService } from './note-sweep-service.js';
import { PushDispatchService } from '../push/push-dispatch-service.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import { InMemoryPushSubscriptionRepository } from '../../adapters/push/in-memory-push-subscription-repository.js';
import { InMemoryPushBudgetRepository } from '../../adapters/push/in-memory-push-budget-repository.js';
import type { PushSender } from '../../ports/push.js';
import type { NoteRecord } from '../../ports/note-repository.js';

const NOW = Date.parse('2026-08-14T09:00:00Z');
const sub = { endpoint: 'https://push.test/a', keys: { p256dh: 'k', auth: 'a' } };

function importNote(over: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: 'n1', clientId: 'c1', source: 'whatsapp_export', rawText: 'chat', audioKey: null,
    status: 'extracted', sweepAttempts: 1, createdAt: NOW, embedding: null,
    extracted: { promises: [{}, {}], requirements: [{}], key_dates: [], people: [{}] },
    messages: new Array(1240).fill({ sender: 'x', body: 'y', sentAt: null }),
    ...over,
  } as NoteRecord;
}

function make(note: NoteRecord | null) {
  const sender: PushSender = { send: vi.fn().mockResolvedValue(undefined) };
  const notifications = new InMemoryNotificationRepository();
  const subs = new InMemoryPushSubscriptionRepository();
  const budget = new InMemoryPushBudgetRepository();
  const dispatch = new PushDispatchService(sender, subs, notifications, budget);
  const notes = { findByIdForUser: vi.fn().mockResolvedValue(note) };
  const clients = { findByIdForUser: vi.fn().mockResolvedValue({ id: 'c1', name: 'Acme' }) };
  const svc = new ImportCompletionService({
    notes: notes as never, clients: clients as never,
    dispatch: (u, a, n) => dispatch.dispatch(u, a, n), now: () => NOW,
  });
  return { svc, sender, notifications, subs, budget };
}

describe('[IMPORT-DONE] completion notice', () => {
  it('SUCCESS notifies once with message count + findings, linking to the Book Scan', async () => {
    const { svc, sender, notifications, subs } = make(importNote());
    await subs.save('u', sub);
    await svc.onNoteSettled('u', 'n1');
    const inApp = await notifications.listByUser('u');
    expect(inApp).toHaveLength(1);
    expect(inApp[0]!.type).toBe('import_complete');
    expect(inApp[0]!.body).toMatch(/1,240 messages/);
    expect(inApp[0]!.body).toMatch(/2 promises, 1 requirement, 1 person/); // what was found
    expect(sender.send).toHaveBeenCalledWith(sub, expect.objectContaining({ url: '/app?client=c1' }));
  });

  it('FAILURE (needs_review) notifies plainly — silent failure is the worst outcome', async () => {
    const { svc, notifications } = make(importNote({ status: 'needs_review' }));
    await svc.onNoteSettled('u', 'n1');
    const inApp = await notifications.listByUser('u');
    expect(inApp).toHaveLength(1);
    expect(inApp[0]!.title).toMatch(/needs a look/i);
  });

  it('records the notice in-app even with push disabled (no devices)', async () => {
    const { svc, sender, notifications } = make(importNote());
    await svc.onNoteSettled('u', 'n1'); // no subs saved → push disabled
    expect(sender.send).not.toHaveBeenCalled();
    expect(await notifications.listByUser('u')).toHaveLength(1); // still in-app
  });

  it('does NOT notify for a non-import note, nor before a terminal state', async () => {
    const voice = make(importNote({ source: 'voice' as never }));
    await voice.svc.onNoteSettled('u', 'n1');
    expect(await voice.notifications.listByUser('u')).toHaveLength(0);

    const pending = make(importNote({ status: 'pending_extraction' }));
    await pending.svc.onNoteSettled('u', 'n1');
    expect(await pending.notifications.listByUser('u')).toHaveLength(0);
  });

  it('is idempotent — calling twice does not create a second in-app notice', async () => {
    const { svc, notifications } = make(importNote());
    await svc.onNoteSettled('u', 'n1');
    await svc.onNoteSettled('u', 'n1');
    expect(await notifications.listByUser('u')).toHaveLength(1);
  });
});

describe('[IMPORT-DONE] the sweep settles a note once', () => {
  it('calls onSettled after extraction, and NOT again on a re-run (the note is no longer pending)', async () => {
    // The note starts pending_extraction; extract() flips it to extracted so it drops out of the queue.
    const store: Record<string, { status: string; sweepAttempts: number }> = { n1: { status: 'pending_extraction', sweepAttempts: 0 } };
    const onSettled = vi.fn().mockResolvedValue(undefined);
    const sweep = new NoteSweepService({
      allUserIds: async () => ['u'],
      listPending: async () => Object.entries(store).filter(([, n]) => n.status.startsWith('pending')).map(([id, n]) => ({ id, status: n.status, sweepAttempts: n.sweepAttempts })),
      transcribe: async () => {},
      extract: async () => { store.n1!.status = 'extracted'; },
      setAttempts: async (_u, id, n) => { store[id]!.sweepAttempts = n; },
      markNeedsReview: async (_u, id) => { store[id]!.status = 'needs_review'; },
      onSettled,
    });

    await sweep.sweep('2026-08-14');
    expect(onSettled).toHaveBeenCalledTimes(1);
    await sweep.sweep('2026-08-14'); // re-run: n1 is 'extracted', no longer pending
    expect(onSettled).toHaveBeenCalledTimes(1); // not re-notified
  });

  it('a notify failure never breaks the sweep (best-effort)', async () => {
    const store = { n1: { status: 'pending_extraction', sweepAttempts: 0 } };
    const sweep = new NoteSweepService({
      allUserIds: async () => ['u'],
      listPending: async () => Object.entries(store).filter(([, n]) => n.status.startsWith('pending')).map(([id, n]) => ({ id, status: n.status, sweepAttempts: n.sweepAttempts })),
      transcribe: async () => {},
      extract: async () => { store.n1.status = 'extracted'; },
      setAttempts: async () => {},
      markNeedsReview: async () => {},
      onSettled: async () => { throw new Error('push down'); },
    });
    const res = await sweep.sweep('2026-08-14');
    expect(res.advanced).toBe(1); // the note still advanced despite the notify throwing
  });
});
