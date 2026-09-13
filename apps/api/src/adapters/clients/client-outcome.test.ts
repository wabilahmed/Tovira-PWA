import { describe, it, expect } from 'vitest';
import { InMemoryClientRepository } from './in-memory-client-repository.js';

// [OUTCOME-1] Deal outcome per client: capture only, no analysis. A new client starts 'open'
// with no source and no changed-at. Setting an outcome records WHO set it ('rep' | 'inferred')
// and WHEN. The whole point of outcome_source is that a later analysis can tell a confirmed
// loss from an inferred one — so it must round-trip and be isolated per account exactly like
// every other client field (RLS in Postgres; the same contract mirrored here).
describe('[OUTCOME-1] client outcome field', () => {
  it('a new client defaults to open, with no source and no changed-at', async () => {
    const repo = new InMemoryClientRepository();
    const c = await repo.create('user-A', 'A Corp');
    expect(c.outcome).toBe('open');
    expect(c.outcomeSource).toBeNull();
    expect(c.outcomeChangedAt).toBeNull();
  });

  it('records a rep-set outcome with its source and changed-at', async () => {
    const repo = new InMemoryClientRepository();
    const c = await repo.create('user-A', 'A Corp');
    await repo.setOutcome('user-A', c.id, 'won', 'rep', 1_700_000_000_000);
    const after = (await repo.findByIdForUser('user-A', c.id))!;
    expect(after.outcome).toBe('won');
    expect(after.outcomeSource).toBe('rep');
    expect(after.outcomeChangedAt).toBe(1_700_000_000_000);
  });

  it('records an inferred loss distinctly from a confirmed one', async () => {
    const repo = new InMemoryClientRepository();
    const confirmed = await repo.create('user-A', 'Confirmed');
    const inferred = await repo.create('user-A', 'Inferred');
    await repo.setOutcome('user-A', confirmed.id, 'lost_confirmed', 'rep', 1);
    await repo.setOutcome('user-A', inferred.id, 'lost_inferred', 'inferred', 2);
    expect((await repo.findByIdForUser('user-A', confirmed.id))!.outcomeSource).toBe('rep');
    expect((await repo.findByIdForUser('user-A', inferred.id))!.outcomeSource).toBe('inferred');
  });

  // ISOLATION — the outcome is not WRITABLE across accounts.
  it('never lets another rep write a client outcome (isolation)', async () => {
    const repo = new InMemoryClientRepository();
    const a = await repo.create('user-A', 'A Corp');
    await repo.setOutcome('user-B', a.id, 'won', 'rep', 5); // wrong owner → no-op
    const after = (await repo.findByIdForUser('user-A', a.id))!;
    expect(after.outcome).toBe('open');
    expect(after.outcomeSource).toBeNull();
  });

  // ISOLATION — the outcome is not READABLE across accounts.
  it('never lets another rep read a client (and its outcome) (IDOR guard)', async () => {
    const repo = new InMemoryClientRepository();
    const a = await repo.create('user-A', 'A Corp');
    await repo.setOutcome('user-A', a.id, 'lost_confirmed', 'rep', 5);
    expect(await repo.findByIdForUser('user-B', a.id)).toBeNull();
  });
});
