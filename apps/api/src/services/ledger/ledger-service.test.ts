import { describe, it, expect } from 'vitest';
import { LedgerService } from './ledger-service.js';
import { InMemoryLedgerRepository } from '../../adapters/ledger/in-memory-ledger-repository.js';
import type { LedgerEvent } from '../../ports/ledger-repository.js';

const ev = (over: Partial<LedgerEvent> = {}): LedgerEvent => ({
  type: 'promise_kept', clientId: 'c1', sourceId: 'p1', dedupeKey: 'kept:p1', occurredAt: 1, ...over,
});

function make() {
  const repo = new InMemoryLedgerRepository();
  return { repo, svc: new LedgerService(repo) };
}

describe('LedgerService (P4-11)', () => {
  it('records real events and counts them by type', async () => {
    const { svc } = make();
    await svc.record('u', ev({ type: 'promise_kept', sourceId: 'p1', dedupeKey: 'kept:p1' }));
    await svc.record('u', ev({ type: 'thread_reopened', sourceId: 'n1', dedupeKey: 'reopen:c1' }));
    const s = await svc.summary('u');
    expect(s.totalTouched).toBe(2);
    expect(s.byType.promise_kept).toBe(1);
    expect(s.byType.thread_reopened).toBe(1);
  });

  it('is idempotent — the same real event never double-counts', async () => {
    const { svc } = make();
    expect(await svc.record('u', ev({ dedupeKey: 'kept:p1' }))).toBe(true);
    expect(await svc.record('u', ev({ dedupeKey: 'kept:p1' }))).toBe(false);
    expect((await svc.summary('u')).totalTouched).toBe(1);
  });

  // HONESTY: no deal values entered → counts only, NO AED figure (never estimated).
  it('shows no AED figure until the rep enters deal values', async () => {
    const { svc } = make();
    await svc.record('u', ev());
    expect((await svc.summary('u')).aed).toBeNull();
  });

  it('includes AED only from entered deal values, for touched clients', async () => {
    const { svc } = make();
    await svc.record('u', ev({ clientId: 'c1' }));
    await svc.setDealValue('u', 'c1', 500000);
    await svc.setDealValue('u', 'c2', 999); // a client with no ledger event
    expect((await svc.summary('u')).aed).toBe(500000); // only touched c1 counts
  });

  // HONESTY: deleting the underlying event removes the ledger entry (no orphans).
  it('removes a ledger entry when its source event is deleted', async () => {
    const { svc } = make();
    await svc.record('u', ev({ sourceId: 'p1' }));
    expect((await svc.summary('u')).totalTouched).toBe(1);
    await svc.removeBySource('u', 'p1');
    expect((await svc.summary('u')).totalTouched).toBe(0);
  });

  // HONESTY: recomputed from events (not a cached counter) — so it can't inflate.
  it('every item links to its underlying event', async () => {
    const { svc } = make();
    await svc.record('u', ev({ sourceId: 'p42' }));
    const s = await svc.summary('u');
    expect(s.items[0]!.sourceId).toBe('p42');
  });

  it('is tenant-scoped', async () => {
    const { svc } = make();
    await svc.record('a', ev());
    await svc.setDealValue('a', 'c1', 100);
    const s = await svc.summary('b');
    expect(s.totalTouched).toBe(0);
    expect(s.aed).toBeNull();
  });
});
