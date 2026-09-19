import { describe, it, expect, vi } from 'vitest';
import { ErasureRequestService, DEFAULT_ERASURE_WINDOW_DAYS } from './erasure-request-service.js';
import { ErasureService } from './erasure-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryErasureAuditRepository } from '../../adapters/erasure/in-memory-erasure-audit-repository.js';
import { InMemoryErasureRequestRepository } from '../../adapters/erasure/in-memory-erasure-request-repository.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import type { PushableAlert } from '../push/push-dispatch-service.js';

const NOW = Date.parse('2026-09-20T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

async function make(nowRef: { t: number }) {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const audit = new InMemoryErasureAuditRepository();
  const requests = new InMemoryErasureRequestRepository();
  const notifications = new InMemoryNotificationRepository();
  const pushed: PushableAlert[] = [];
  const dispatch = vi.fn(async (_u: string, alerts: PushableAlert[]) => { pushed.push(...alerts); });
  const erasure = new ErasureService({ clients, notes, extractionLog: new InMemoryExtractionLogRepository(), audit });
  const svc = new ErasureRequestService({ erasure, requests, notifications, dispatch, now: () => nowRef.t });
  const c = await clients.create('u', 'Marina Estates');
  const n = await notes.create('u', { clientId: c.id, source: 'whatsapp_export', audioKey: null, status: 'extracted', rawText: 'x', messages: [{ sentAt: '2026-01-01T10:00:00', sender: 'Khalid', body: 'i have five million', media: false, role: 'unknown' }] });
  await notes.update('u', n.id, { extracted: { people: [{ name: 'Khalid', role: null, reports_to: null, decision_role: 'unknown', notes: null }], personal_facts: [{ subject: 'Khalid', fact: 'has five million', category: 'background', source_span: null, source_message_at: null }], promises: [], key_dates: [], concerns: [], next_steps: [], meeting: null, unanswered_questions: [] } });
  return { svc, notes, notifications, requests, pushed, dispatch, noteId: n.id };
}

describe('[ERASURE Task 4] telling the rep + the retention window', () => {
  it('opening a request notifies the rep: legal, cannot decline, categories, and a window date', async () => {
    const ref = { t: NOW };
    const { svc, notifications, pushed, requests } = await make(ref);
    const req = await svc.open('u', ['Khalid']);
    expect(req.windowEndsAt).toBe(NOW + DEFAULT_ERASURE_WINDOW_DAYS * DAY); // default 14 days
    const [n] = await notifications.listByUser('u');
    expect(n!.type).toBe('erasure_pending');
    expect(n!.body).toMatch(/cannot decline/i);
    expect(n!.body).toMatch(/people|personal_facts/); // categories named
    expect(n!.body).toContain('2026-10-04'); // NOW + 14 days
    expect(pushed.some((a) => a.type === 'erasure_pending')).toBe(true); // pushed, not silent
    expect((await requests.listByUser('u'))[0]!.status).toBe('pending');
  });

  it('does NOT erase before the window closes', async () => {
    const ref = { t: NOW };
    const { svc, notes, noteId } = await make(ref);
    const req = await svc.open('u', ['Khalid']);
    ref.t = NOW + 5 * DAY; // still inside the 14-day window
    const res = await svc.complete('u', req.id);
    expect(res).toEqual({ ok: false, reason: 'window_open' });
    const people = (await notes.findByIdForUser('u', noteId))!.extracted as { people: unknown[] };
    expect(people.people).toHaveLength(1); // untouched — nothing erased yet
  });

  it('completes AFTER the window and tells the rep what was removed', async () => {
    const ref = { t: NOW };
    const { svc, notes, notifications, noteId } = await make(ref);
    const req = await svc.open('u', ['Khalid']);
    ref.t = NOW + 15 * DAY; // window elapsed
    const res = await svc.complete('u', req.id);
    expect(res.ok).toBe(true);
    const people = (await notes.findByIdForUser('u', noteId))!.extracted as { people: unknown[] };
    expect(people.people).toHaveLength(0); // erased
    const done = (await notifications.listByUser('u')).find((x) => x.type === 'erasure_completed');
    expect(done).toBeTruthy();
    expect(done!.body).toMatch(/people/); // categories reported
  });

  it('a rep asserting retention blocks completion (a legal hold)', async () => {
    const ref = { t: NOW };
    const { svc, notes, noteId } = await make(ref);
    const req = await svc.open('u', ['Khalid']);
    expect(await svc.assertRetention('u', req.id)).toBe(true);
    ref.t = NOW + 30 * DAY; // even long after the window
    const res = await svc.complete('u', req.id);
    expect(res).toEqual({ ok: false, reason: 'retention_asserted' });
    const people = (await notes.findByIdForUser('u', noteId))!.extracted as { people: unknown[] };
    expect(people.people).toHaveLength(1); // retained
  });

  it('the window is configurable', async () => {
    const ref = { t: NOW };
    const clients = new InMemoryClientRepository();
    const notes = new InMemoryNoteRepository();
    const erasure = new ErasureService({ clients, notes, extractionLog: new InMemoryExtractionLogRepository(), audit: new InMemoryErasureAuditRepository() });
    const svc = new ErasureRequestService({ erasure, requests: new InMemoryErasureRequestRepository(), notifications: new InMemoryNotificationRepository(), dispatch: async () => {}, now: () => ref.t, windowDays: 30 });
    const req = await svc.open('u', ['Khalid']);
    expect(req.windowEndsAt).toBe(NOW + 30 * DAY);
  });
});
