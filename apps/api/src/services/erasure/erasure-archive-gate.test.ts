import { describe, it, expect, vi } from 'vitest';
import { ErasureRequestService } from './erasure-request-service.js';
import { ErasureService } from './erasure-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { InMemoryErasureAuditRepository } from '../../adapters/erasure/in-memory-erasure-audit-repository.js';
import { InMemoryErasureRequestRepository } from '../../adapters/erasure/in-memory-erasure-request-repository.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import { InMemoryArchiveIndexRepository } from '../../adapters/logs/in-memory-archive-index-repository.js';
import type { Storage } from '../../ports/storage.js';

/**
 * [ERASURE-ARCHIVE Task 4] THE GATE: an erasure cannot complete unless the archive purge ran. If the
 * object store is unreachable, the erasure fails loudly and the request stays OPEN — never a silent gap.
 */

const NOW = Date.parse('2026-09-20T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

// A Storage whose get() throws — the archive is unreachable (object store down / creds missing).
const downStorage = (): Storage => ({
  get: async () => { throw new Error('object store unavailable'); },
  put: vi.fn(async () => {}),
  exists: async () => true,
  delete: async () => {},
});

async function make(nowRef: { t: number }) {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const notifications = new InMemoryNotificationRepository();
  const requests = new InMemoryErasureRequestRepository();
  const archiveIndex = new InMemoryArchiveIndexRepository();
  await archiveIndex.upsert('u', { collection: 'extraction_logs', partition: '2026-01', objectKey: 'k/u/2026-01.ndjson', rowCount: 1 });
  const erasure = new ErasureService({ clients, notes, extractionLog: new InMemoryExtractionLogRepository(), audit: new InMemoryErasureAuditRepository(), archiveIndex, archiveStorage: downStorage() });
  const svc = new ErasureRequestService({ erasure, requests, notifications, dispatch: vi.fn(async () => {}), now: () => nowRef.t });
  return { svc, requests, notifications };
}

describe('[ERASURE-ARCHIVE Task 4] the completion gate', () => {
  it('archive unreachable → the erasure does NOT complete, the request stays open, the error surfaces', async () => {
    const ref = { t: NOW };
    const { svc, requests, notifications } = await make(ref);
    const req = await svc.open('u', ['Khalid']);
    ref.t = NOW + 15 * DAY; // window elapsed
    const res = await svc.complete('u', req.id);
    expect(res.ok).toBe(false); // failed loudly
    expect(res.reason).toMatch(/incomplete|unavailable/i); // error surfaced
    expect((await requests.get('u', req.id))!.status).toBe('pending'); // stays OPEN, not completed
    expect((await notifications.listByUser('u')).some((n) => n.type === 'erasure_completed')).toBe(false); // no false "done"
  });
});
