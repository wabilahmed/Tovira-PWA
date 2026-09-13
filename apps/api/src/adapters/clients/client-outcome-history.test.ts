import { describe, it, expect } from 'vitest';
import { InMemoryClientRepository } from './in-memory-client-repository.js';

// [OUTCOME-FOLLOWUP-2] Append-only history of every outcome transition per client. The live field is
// a snapshot; when an inferred loss revives, the inference vanishes with no trace. The history keeps
// it, so "how often does an inferred loss come back?" — the calibration question — stays answerable.
// A transition row records the previous value, the new value, the ACTOR ('rep' | 'inferred'), and when.
describe('[OUTCOME-FOLLOWUP-2] client outcome history', () => {
  it('records a rep-set transition (open → won by rep)', async () => {
    const repo = new InMemoryClientRepository();
    const c = await repo.create('user-A', 'Won Corp');
    await repo.setOutcome('user-A', c.id, 'won', 'rep', 1000);
    const hist = await repo.listOutcomeHistory('user-A', c.id);
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ clientId: c.id, previous: 'open', next: 'won', source: 'rep', changedAt: 1000 });
  });

  it('records an inferred loss AND its reversion — the calibration trail', async () => {
    const repo = new InMemoryClientRepository();
    const c = await repo.create('user-A', 'Revived');
    await repo.setOutcome('user-A', c.id, 'lost_inferred', 'inferred', 2000); // inference marks lost
    await repo.clearOutcome('user-A', c.id, 'inferred', 3000);                 // activity resumed → revert
    const hist = await repo.listOutcomeHistory('user-A', c.id);
    expect(hist.map((h) => `${h.previous}->${h.next}:${h.source}`)).toEqual([
      'open->lost_inferred:inferred',
      'lost_inferred->open:inferred',
    ]);
  });

  it('distinguishes a REP revival of an inferred loss ("still open") from an activity revival', async () => {
    const repo = new InMemoryClientRepository();
    const c = await repo.create('user-A', 'Rep Revived');
    await repo.setOutcome('user-A', c.id, 'lost_inferred', 'inferred', 2000);
    await repo.clearOutcome('user-A', c.id, 'rep', 3000); // rep tapped "still open"
    const hist = await repo.listOutcomeHistory('user-A', c.id);
    expect(hist[1]).toMatchObject({ previous: 'lost_inferred', next: 'open', source: 'rep' });
  });

  it('is append-only: a no-op write (same value) adds no row', async () => {
    const repo = new InMemoryClientRepository();
    const c = await repo.create('user-A', 'Steady');
    await repo.setOutcome('user-A', c.id, 'won', 'rep', 1000);
    await repo.setOutcome('user-A', c.id, 'won', 'rep', 1500); // no change
    await repo.clearOutcome('user-A', c.id, 'rep', 1600);       // open->? real change (won->open)
    await repo.clearOutcome('user-A', c.id, 'rep', 1700);       // already open/untouched → no change
    const hist = await repo.listOutcomeHistory('user-A', c.id);
    expect(hist.map((h) => `${h.previous}->${h.next}`)).toEqual(['open->won', 'won->open']);
  });

  // ISOLATION — history is not READABLE across accounts.
  it('never returns another rep\'s outcome history', async () => {
    const repo = new InMemoryClientRepository();
    const a = await repo.create('user-A', 'A Corp');
    await repo.setOutcome('user-A', a.id, 'won', 'rep', 1000);
    expect(await repo.listOutcomeHistory('user-B', a.id)).toEqual([]);
  });

  // ISOLATION — a cross-account write logs nothing on the victim's history.
  it('never lets another rep write (or log) against a client they do not own', async () => {
    const repo = new InMemoryClientRepository();
    const a = await repo.create('user-A', 'A Corp');
    await repo.setOutcome('user-B', a.id, 'lost_confirmed', 'rep', 1000); // wrong owner → no-op
    expect(await repo.listOutcomeHistory('user-A', a.id)).toEqual([]);
  });

  // Account deletion (in-memory path) purges history via the client repo's purgeUser.
  it('purges history when the account is purged', async () => {
    const repo = new InMemoryClientRepository();
    const a = await repo.create('user-A', 'A Corp');
    await repo.setOutcome('user-A', a.id, 'won', 'rep', 1000);
    await repo.purgeUser('user-A');
    expect(await repo.listOutcomeHistory('user-A', a.id)).toEqual([]);
  });
});
