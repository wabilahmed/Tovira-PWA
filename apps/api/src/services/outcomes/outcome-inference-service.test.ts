import { describe, it, expect } from 'vitest';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { OutcomeInferenceService } from './outcome-inference-service.js';

const DAY = 86_400_000;
const N = 90; // matches the default LOST_INFERRED_THRESHOLD_DAYS (see config derivation)

/** Push a client's last-touch back by `days`, so silence is deterministic in tests. */
async function silentFor(repo: InMemoryClientRepository, userId: string, id: string, days: number, nowMs: number): Promise<void> {
  await repo.setLastTouched(userId, id, nowMs - days * DAY);
}

function service(repo: InMemoryClientRepository): OutcomeInferenceService {
  return new OutcomeInferenceService({
    clients: repo,
    allUserIds: async () => ['user-A'],
    thresholdDays: N,
  });
}

// [OUTCOME-2] The deterministic silence rule: NO model call. A client becomes lost_inferred when
// there has been no activity in either direction for N days AND no won signal. It is recomputable
// and reversible, and a rep-set outcome ALWAYS wins.
describe('[OUTCOME-2] lost_inferred silence rule', () => {
  const now = 10_000 * DAY; // a fixed "today" far from epoch

  it('marks an open, long-silent client lost_inferred (source = inferred)', async () => {
    const repo = new InMemoryClientRepository();
    const c = await repo.create('user-A', 'Silent Corp');
    await silentFor(repo, 'user-A', c.id, N + 1, now);
    await service(repo).recompute(now);
    const after = (await repo.findByIdForUser('user-A', c.id))!;
    expect(after.outcome).toBe('lost_inferred');
    expect(after.outcomeSource).toBe('inferred');
    expect(after.outcomeChangedAt).toBe(now);
  });

  it('leaves a recently-touched client open', async () => {
    const repo = new InMemoryClientRepository();
    const c = await repo.create('user-A', 'Active Corp');
    await silentFor(repo, 'user-A', c.id, N - 1, now);
    await service(repo).recompute(now);
    expect((await repo.findByIdForUser('user-A', c.id))!.outcome).toBe('open');
  });

  it('never overwrites a rep-set outcome — won stays won (no won signal means outcome is NOT won)', async () => {
    const repo = new InMemoryClientRepository();
    const c = await repo.create('user-A', 'Won Corp');
    await repo.setOutcome('user-A', c.id, 'won', 'rep', now - 200 * DAY);
    await silentFor(repo, 'user-A', c.id, N + 100, now); // long silent, but won
    await service(repo).recompute(now);
    const after = (await repo.findByIdForUser('user-A', c.id))!;
    expect(after.outcome).toBe('won');
    expect(after.outcomeSource).toBe('rep');
  });

  it('never overwrites a rep-confirmed loss — source = rep always wins over inference', async () => {
    const repo = new InMemoryClientRepository();
    const c = await repo.create('user-A', 'Confirmed Lost');
    await repo.setOutcome('user-A', c.id, 'lost_confirmed', 'rep', now - 200 * DAY);
    await silentFor(repo, 'user-A', c.id, N + 100, now);
    await service(repo).recompute(now);
    const after = (await repo.findByIdForUser('user-A', c.id))!;
    expect(after.outcome).toBe('lost_confirmed');
    expect(after.outcomeSource).toBe('rep');
  });

  // [FOLLOWUP-1] "still open" is a snooze, not a pin: it clears to the untouched default (source
  // unset) and resets the clock, so the client is eligible to be inferred lost if it goes silent again.
  it('does NOT exempt a snoozed "still open" client from a later inference run', async () => {
    const repo = new InMemoryClientRepository();
    const c = await repo.create('user-A', 'Snoozed');
    await repo.clearOutcome('user-A', c.id); // "still open" leaves outcome_source unset
    await repo.touch('user-A', c.id);        // clock reset (the snooze)
    await silentFor(repo, 'user-A', c.id, N + 1, now); // silent again, past the threshold
    await service(repo).recompute(now);
    expect((await repo.findByIdForUser('user-A', c.id))!.outcome).toBe('lost_inferred');
  });

  it('is reversible: activity resuming returns a lost_inferred client to open and clears the inferred value', async () => {
    const repo = new InMemoryClientRepository();
    const c = await repo.create('user-A', 'Recovered');
    await silentFor(repo, 'user-A', c.id, N + 1, now);
    await service(repo).recompute(now); // → lost_inferred
    expect((await repo.findByIdForUser('user-A', c.id))!.outcome).toBe('lost_inferred');
    // A new message/capture bumps last-touch; the next run must clear the inference.
    await repo.touch('user-A', c.id);
    await service(repo).recompute(now);
    const after = (await repo.findByIdForUser('user-A', c.id))!;
    expect(after.outcome).toBe('open');
    expect(after.outcomeSource).toBeNull();
    expect(after.outcomeChangedAt).toBeNull();
  });

  it('is idempotent: a still-silent lost_inferred client is not rewritten', async () => {
    const repo = new InMemoryClientRepository();
    const c = await repo.create('user-A', 'Still Silent');
    await silentFor(repo, 'user-A', c.id, N + 5, now);
    await service(repo).recompute(now);
    const firstChangedAt = (await repo.findByIdForUser('user-A', c.id))!.outcomeChangedAt;
    await service(repo).recompute(now + DAY); // still silent, a day later
    const after = (await repo.findByIdForUser('user-A', c.id))!;
    expect(after.outcome).toBe('lost_inferred');
    expect(after.outcomeChangedAt).toBe(firstChangedAt); // not re-stamped
  });
});
