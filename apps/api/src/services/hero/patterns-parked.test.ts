import { describe, it, expect } from 'vitest';
import { HeroService } from './hero-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryMeetingRepository } from '../../adapters/meetings/in-memory-meeting-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { loadConfig } from '../../config.js';

/** [P40-3 · owner] Cross-client patterns are parked: the code stays, a config switch (PATTERNS_ENABLED) is OFF by
 *  default, and while it is off they show nowhere — GET /hero/patterns returns none. */
const NOW = Date.parse('2026-07-09T12:00:00Z');
async function qualifying(opts?: { patternsEnabled?: boolean }) {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const hero = new HeroService({ clients, facts: new InMemoryFactsRepository(), meetings: new InMemoryMeetingRepository(), notes }, { minClients: 1, minNotes: 0 }, 30, 90, undefined, undefined, opts);
  for (const name of ['A', 'B']) {
    const c = await clients.create('u', name);
    (c as { lastTouchedAt: number }).lastTouchedAt = NOW - 45 * 86_400_000;
    const n = await notes.create('u', { clientId: c.id, source: 'voice', rawText: 'x', audioKey: null, status: 'extracted' });
    await notes.update('u', n.id, { extracted: { summary: '', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], meeting: null } });
  }
  return hero;
}

describe('[P40-3] patterns are parked', () => {
  it('off by default: a book that would show a pattern shows none', async () => {
    expect(await (await qualifying()).patterns('u', NOW)).toEqual([]);
  });
  it('the code is kept: switched on, the same book shows it', async () => {
    expect((await (await qualifying({ patternsEnabled: true })).patterns('u', NOW)).map((p) => p.id)).toContain('quiet-no-decision-maker');
  });
  it('the switch is PATTERNS_ENABLED, off unless set to "true"', () => {
    const base = { DATABASE_URL: 'postgres://x', NODE_ENV: 'test' } as NodeJS.ProcessEnv;
    expect(loadConfig(base).patternsEnabled).toBe(false);
    expect(loadConfig({ ...base, PATTERNS_ENABLED: 'true' }).patternsEnabled).toBe(true);
  });
});
