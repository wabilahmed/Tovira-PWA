import { describe, it, expect } from 'vitest';
import { FindService } from './find-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryRequirementRepository } from '../../adapters/requirements/in-memory-requirement-repository.js';

/** [P40-5] Find's "Clients wanting…" matches within ONE requirement — never a field from one and a field from another. */
async function setup() {
  const clients = new InMemoryClientRepository();
  const notes = new InMemoryNoteRepository();
  const requirements = new InMemoryRequirementRepository();
  const c = await clients.create('u', 'QA Ahmed Al Mansouri');
  await requirements.saveForNote('u', 'n1', c.id, [
    { text: 'A 1 bed flat for his son', requirementRaw: 'I need a 1 bed flat for my son near his university', statedOn: '2026-09-01', confidence: 'high', embedding: null },
    { text: '3 bedroom villa in Arabian Ranches', requirementRaw: "I'm looking for a 3 bedroom villa in Arabian Ranches, budget around 4.5M", statedOn: '2026-09-10', confidence: 'high', embedding: null },
  ]);
  const find = new FindService({ clients, facts: new InMemoryFactsRepository(), notes, requirements, hero: { risk: async () => [] }, coldThresholdDays: 30, promiseStaleThresholdDays: 90 });
  return { find };
}
const NOW = Date.parse('2026-10-22T09:00:00Z');

describe('[P40-5] Find filters match within a single requirement', () => {
  it('negative: "1BR" + "Villa" does NOT match (1BR is the flat, Villa is the other requirement)', async () => {
    const { find } = await setup();
    expect((await find.run('u', 'wanting', NOW, [{ by: 'beds', value: '1BR' }, { by: 'type', value: 'Villa' }])).count).toBe(0);
  });
  it('"3BR" + "Villa" + "Arabian Ranches" matches (all in one requirement)', async () => {
    const { find } = await setup();
    expect((await find.run('u', 'wanting', NOW, [{ by: 'beds', value: '3BR' }, { by: 'type', value: 'Villa' }, { by: 'area', value: 'Arabian Ranches' }])).count).toBe(1);
  });
  it('one filter at a time still finds either requirement: Apartment, or Villa', async () => {
    const { find } = await setup();
    expect((await find.run('u', 'wanting', NOW, { by: 'type', value: 'Apartment' })).count).toBe(1);
    expect((await find.run('u', 'wanting', NOW, { by: 'type', value: 'Villa' })).count).toBe(1);
  });
  it('negative: "Apartment" + budget band AED 2M to 5M does not match (the budget belongs to the villa)', async () => {
    const { find } = await setup();
    expect((await find.run('u', 'wanting', NOW, [{ by: 'type', value: 'Apartment' }, { by: 'budget', value: '2m-5m' }])).count).toBe(0);
  });
  it('the row reads the one-requirement line', async () => {
    const { find } = await setup();
    expect((await find.run('u', 'open-requirements', NOW)).items[0]!.line).toBe('3BR Villa · Arabian Ranches · ~AED 4.5M · +1 more');
  });
  it("options list each requirement's own values", async () => {
    const { find } = await setup();
    const o = await find.wantingOptions('u');
    expect(o.type).toEqual(['Apartment', 'Villa']);
    expect(o.area).toEqual(['Arabian Ranches']);
  });
});
