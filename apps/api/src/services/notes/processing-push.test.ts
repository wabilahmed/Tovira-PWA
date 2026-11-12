import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ImportCompletionService } from './import-completion-service.js';
import { PushDispatchService } from '../push/push-dispatch-service.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import { InMemoryPushSubscriptionRepository } from '../../adapters/push/in-memory-push-subscription-repository.js';
import { AppPresence } from '../processing/presence.js';
import type { PushSender } from '../../ports/push.js';
import type { NoteRecord } from '../../ports/note-repository.js';

// [P69 · owner] "Reading…" → "Analysing…" everywhere (one voice): the pinned wording below changed by owner decision.

// [P65-5 · owner] When the app is closed and reading took over 30 seconds, a push says so: "Tovira finished analysing your
// chat with Anjali Mehra." Only then: never while the app is open (it shows a toast instead), never for something that
// was done in under 30 seconds, and only to a device the rep turned notifications on for. Chats, voice notes and typed
// notes alike; a chat is still recorded in the in-app list as before.
const NOW = Date.parse('2026-11-05T09:00:00Z');
const sub = { endpoint: 'https://push.test/a', keys: { p256dh: 'k', auth: 'a' } };
function note(over: Partial<NoteRecord> = {}): NoteRecord {
  return { id: 'n1', userId: 'u', clientId: 'c1', source: 'whatsapp_export', rawText: 'chat', audioKey: null, status: 'extracted', sweepAttempts: 1, extracted: { promises: [{}], requirements: [], key_dates: [], people: [] }, messages: [{ sentAt: null, sender: 'x', body: 'y', media: false, role: 'client' }], createdAt: NOW - 95_000, settledAt: NOW, ...over } as NoteRecord;
}
async function make(n: NoteRecord, opts: { open?: boolean; device?: boolean } = {}) {
  const sender: PushSender = { send: vi.fn().mockResolvedValue(undefined) };
  const notifications = new InMemoryNotificationRepository();
  const subs = new InMemoryPushSubscriptionRepository();
  if (opts.device !== false) await subs.save('u', sub as never);
  const dispatch = new PushDispatchService(sender, subs, notifications);
  const presence = new AppPresence(() => NOW);
  if (opts.open) presence.seen('u');
  const svc = new ImportCompletionService({
    notes: { findByIdForUser: vi.fn().mockResolvedValue(n) } as never,
    clients: { findByIdForUser: vi.fn().mockResolvedValue({ id: 'c1', name: 'Anjali Mehra' }) } as never,
    dispatch: (u, a, t) => dispatch.dispatch(u, a, t), now: () => NOW,
    kinds: ['chat', 'voice', 'typed'], shouldPush: (u, x) => (x.settledAt ?? NOW) - x.createdAt > 30_000 && !presence.isOpen(u),
  });
  return { svc, sender, notifications };
}

describe('[P65-5] the push when it is done', () => {
  it('app closed, took over 30 seconds, notifications on: "Tovira finished analysing your chat with Anjali Mehra."', async () => {
    const { svc, sender } = await make(note());
    await svc.onNoteSettled('u', 'n1');
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect((sender.send as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({ title: 'Tovira finished analysing your chat with Anjali Mehra.', url: '/app?client=c1' });
  });
  it('a voice note and a typed note too', async () => {
    for (const [source, title] of [['voice', 'Tovira finished analysing your voice note about Anjali Mehra.'], ['paste', 'Tovira finished analysing your note about Anjali Mehra.']] as const) {
      const { svc, sender } = await make(note({ source, messages: null }));
      await svc.onNoteSettled('u', 'n1');
      expect((sender.send as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({ title });
    }
  });
  it('a failure is pushed the same way, plainly', async () => {
    const { svc, sender } = await make(note({ status: 'needs_review', source: 'voice', messages: null }));
    await svc.onNoteSettled('u', 'n1');
    expect((sender.send as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({ title: "Tovira couldn't analyse your voice note about Anjali Mehra." });
  });
  it('NEGATIVE: the app is open: no push (the app shows a toast); a chat is still recorded in the in-app list', async () => {
    const { svc, sender, notifications } = await make(note(), { open: true });
    await svc.onNoteSettled('u', 'n1');
    expect(sender.send).not.toHaveBeenCalled();
    expect(await notifications.listByUser('u')).toHaveLength(1);
  });
  it('NEGATIVE: done in 30 seconds or less: no push', async () => {
    const { svc, sender } = await make(note({ createdAt: NOW - 30_000 }));
    await svc.onNoteSettled('u', 'n1');
    expect(sender.send).not.toHaveBeenCalled();
  });
  it('NEGATIVE: notifications off (no device subscribed): no push', async () => {
    const { svc, sender } = await make(note(), { device: false });
    await svc.onNoteSettled('u', 'n1');
    expect(sender.send).not.toHaveBeenCalled();
  });
  it('NEGATIVE: a voice or typed note with the app open records nothing (the toast and the card say it)', async () => {
    const { svc, sender, notifications } = await make(note({ source: 'paste', messages: null }), { open: true });
    await svc.onNoteSettled('u', 'n1');
    expect(sender.send).not.toHaveBeenCalled();
    expect(await notifications.listByUser('u')).toHaveLength(0);
  });
  it('the app wires it: every kind, pushed only when closed and over 30 seconds', () => {
    for (const f of ['../../index.ts', '../../http/test-deps.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src).toMatch(/kinds: \['chat', 'voice', 'typed'\]/);
      expect(src).toMatch(/shouldPush: \(u, n\) => \(n\.settledAt \?\? Date\.now\(\)\) - n\.createdAt > 30_000 && !\w+\.isOpen\(u\)/);
    }
  });
});
