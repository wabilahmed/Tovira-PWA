import { describe, it, expect } from 'vitest';
import { FindService } from './find-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryRequirementRepository } from '../../adapters/requirements/in-memory-requirement-repository.js';

/** [P40-3 · owner] A Warm client silent 30+ days is in Active AND in Cold ("Gone quiet"); the Cold row carries the
 *  Warm status so the overlap is visible. Reading the list never changes the status. */
const NOW = Date.parse('2026-10-22T09:00:00Z');
describe('[P40-3] the Active / Cold overlap is visible', () => {
  it('a Warm client silent 40 days: in both lists, the Cold row says Warm and "Gone quiet, 40 days"', async () => {
    const clients = new InMemoryClientRepository();
    const c = await clients.create('u', 'Sara Khan');
    await clients.setLeadStatus('u', c.id, 'warm', NOW);
    (c as { lastTouchedAt: number }).lastTouchedAt = NOW - 40 * 86_400_000;
    const find = new FindService({ clients, facts: new InMemoryFactsRepository(), notes: new InMemoryNoteRepository(), requirements: new InMemoryRequirementRepository(), hero: { risk: async () => [] }, coldThresholdDays: 30, promiseStaleThresholdDays: 90 });
    const cold = await find.run('u', 'cold-clients', NOW);
    expect(cold.items[0]).toMatchObject({ clientName: 'Sara Khan', meta: 'Gone quiet, 40 days', leadStatus: 'warm' });
    expect((await find.run('u', 'active-clients', NOW)).items.map((i) => i.clientName)).toEqual(['Sara Khan']);
    expect((await clients.findByIdForUser('u', c.id))!.leadStatus).toBe('warm'); // never changed
  });
});
