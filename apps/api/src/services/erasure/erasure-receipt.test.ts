import { describe, it, expect } from 'vitest';
import { ErasureService } from './erasure-service.js';
import { ErasureRequestService } from './erasure-request-service.js';
import { AccountService, type UserPurgeable } from '../account/account-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryErasureAuditRepository } from '../../adapters/erasure/in-memory-erasure-audit-repository.js';
import { InMemoryErasureRequestRepository } from '../../adapters/erasure/in-memory-erasure-request-repository.js';
import { InMemoryErasureReceiptRepository } from '../../adapters/erasure/in-memory-erasure-receipt-repository.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import { InMemoryRecallSessionRepository } from '../../adapters/recall/in-memory-recall-session-repository.js';
import type { AuthService } from '../auth/auth-service.js';
import type { ClientRepository } from '../../ports/client-repository.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import type { FactsRepository } from '../../ports/facts-repository.js';
import type { MeetingRepository } from '../../ports/meeting-repository.js';
import type { ImageRepository } from '../../ports/image-repository.js';

/**
 * [ERASURE-RECEIPT · Privacy §10 Task 3] The tenant erasure_audit dies with the rep's account (users FK
 * cascade), taking the only proof an erasure ran. The receipt store is the durable proof: no user_id/FK,
 * so the cascade can't reach it — and minimal (request id + two dates + per-store counts, no name, no
 * content). These tests prove both: it survives account deletion, and it holds no name or content.
 */

const NOW = Date.parse('2026-09-20T09:00:00Z');

/** Run one erasure to completion; return the stores so a test can then delete the account. */
async function completeAnErasure() {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const audit = new InMemoryErasureAuditRepository();   // the tenant audit — dies with the account
  const receipts = new InMemoryErasureReceiptRepository(); // the durable proof — must outlive it
  const now = { t: NOW };

  const c = await clients.create('u', 'Marina Estates');
  const n = await notes.create('u', {
    clientId: c.id, source: 'whatsapp_export', audioKey: null, status: 'extracted', rawText: 'x',
    messages: [
      { sentAt: '2026-01-01T10:00:00', sender: 'Zelda Quorn', body: 'I hold 4m in escrow', media: false, role: 'unknown' },
      { sentAt: '2026-01-01T10:01:00', sender: 'Alex', body: 'noted', media: false, role: 'client' },
    ],
  });
  await notes.update('u', n.id, { extracted: {
    summary: 'A note.',
    people: [{ name: 'Zelda Quorn', role: null, reports_to: null, decision_role: 'unknown', notes: null }],
    personal_facts: [], promises: [], key_dates: [], concerns: [], next_steps: [], meeting: null, unanswered_questions: [],
  } });

  const erasure = new ErasureService({ clients, notes, extractionLog: new InMemoryExtractionLogRepository(), audit });
  const svc = new ErasureRequestService({ erasure, requests: new InMemoryErasureRequestRepository(), receipts, notifications: new InMemoryNotificationRepository(), dispatch: async () => {}, now: () => now.t });

  const req = await svc.open('u', ['Zelda Quorn']);
  now.t = Date.parse('2026-10-10T00:00:00Z'); // window elapsed
  const done = await svc.complete('u', req.id);
  expect(done.ok).toBe(true);
  return { clients, notes, audit, receipts, req };
}

describe('[ERASURE-RECEIPT] the proof-of-erasure record', () => {
  it('holds NO requester name and NO content — only request id, the two dates, and per-store counts', async () => {
    const { receipts, req } = await completeAnErasure();
    const all = await receipts.list();
    expect(all).toHaveLength(1);
    const r = all[0]!;

    // Exactly the four minimal fields, nothing else.
    expect(Object.keys(r).sort()).toEqual(['categories', 'completedAt', 'receivedAt', 'requestId']);
    expect(r.requestId).toBe(req.id);
    expect(r.receivedAt).toBe(NOW);
    expect(r.completedAt).toBeGreaterThan(r.receivedAt);
    // Category entries are shape-only: {category, deleted}. Counts are real (people + message removed).
    for (const cat of r.categories) expect(Object.keys(cat).sort()).toEqual(['category', 'deleted']);
    expect(r.categories.find((c) => c.category === 'people')?.deleted).toBe(1);
    expect(r.categories.find((c) => c.category === 'messages')?.deleted).toBe(1);

    // NO name, NO content anywhere in the serialised record.
    const blob = JSON.stringify(r);
    expect(blob).not.toMatch(/Zelda/i);
    expect(blob).not.toMatch(/escrow/i); // no message body
    expect(blob).not.toMatch(/Marina/i); // no client name
  });

  it('SURVIVES deletion of the rep account, while the tenant erasure_audit is purged', async () => {
    const { audit, receipts } = await completeAnErasure();
    expect(await audit.listByUser('u')).toHaveLength(1);   // tenant audit present before deletion
    expect(await receipts.list()).toHaveLength(1);          // receipt present before deletion

    // The real account-deletion path. purgeables mirror the prod picture: the tenant erasure_audit is
    // swept (in prod by the users FK cascade — here as a purgeable), and the receipt store is in the
    // fan-out too but MUST be immune (its purgeUser is a no-op — that is the guarantee).
    const account = new AccountService(
      { deleteUser: async () => {}, getPublicUser: async () => null } as unknown as AuthService,
      new InMemoryClientRepository() as ClientRepository,
      new InMemoryNoteRepository() as NoteRepository,
      null as unknown as FactsRepository,
      null as unknown as MeetingRepository,
      null as unknown as ImageRepository,
      new InMemoryRecallSessionRepository(),
      [audit as unknown as UserPurgeable, receipts],
    );
    await account.deleteAccount('u');

    expect(await audit.listByUser('u')).toHaveLength(0); // tenant proof gone with the account
    expect(await receipts.list()).toHaveLength(1);        // compliance proof survives (the whole point)
  });
});
