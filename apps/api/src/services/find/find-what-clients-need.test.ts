import { describe, it, expect } from 'vitest';
import { FindService } from './find-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryRequirementRepository } from '../../adapters/requirements/in-memory-requirement-repository.js';

/**
 * [P42-B5] Owner: "What clients need…" offers only the filters this rep's own data has. Property type and Area only
 * for a rep with property needs; Topic (each need's own short label) and Timing ("Due this month", "Due this
 * quarter", from a date the need itself states) for any rep; budget bands for any rep whose needs carry amounts.
 * Every option comes from stored values; a timing is only a date the resolver reads without guessing.
 */
const NOW = Date.parse('2026-10-25T09:00:00Z');
type Need = { text: string; raw?: string; statedOn: string };

async function rep(needs: Record<string, Need[]>) {
  const clients = new InMemoryClientRepository();
  const requirements = new InMemoryRequirementRepository();
  let n = 0;
  for (const [name, list] of Object.entries(needs)) {
    const c = await clients.create('u', name);
    await requirements.saveForNote('u', `n${n++}`, c.id, list.map((x) => ({ text: x.text, requirementRaw: x.raw ?? x.text, statedOn: x.statedOn, confidence: 'high' as const, embedding: null })));
  }
  return new FindService({ clients, facts: new InMemoryFactsRepository(), notes: new InMemoryNoteRepository(), requirements, hero: { risk: async () => [] }, coldThresholdDays: 30, promiseStaleThresholdDays: 90 });
}

const PROPERTY = { 'Omar Haddad': [{ text: '4BR villa in Mirdif', raw: 'looking for a 4BR villa in Mirdif, budget around 3M', statedOn: '2026-10-01' }] };
const INSURANCE = {
  'Layla Nasser': [{ text: 'Motor and medical cover renewal by the end of the month', statedOn: '2026-10-20' }],
  'Karim Aziz': [{ text: 'Group life cover renewing on 15/11/2026', statedOn: '2026-10-02' }],
  'Hana Saleh': [{ text: 'Home contents cover, premium around 5K', statedOn: '2026-09-01' }],
};

describe('[P42-B5] What clients need…: the options fit the rep', () => {
  it('a property-only rep sees property type, area and budget, and no topic or timing', async () => {
    const o = await (await rep(PROPERTY)).wantingOptions('u', NOW);
    expect(o).toMatchObject({ type: ['Villa'], area: ['Mirdif'], topic: [], timing: [] });
    expect(o.budget.map((b) => b.value)).toEqual(['2m-5m']);
  });

  it('an insurance-only rep sees Topic and Timing, and NO property type or area', async () => {
    const o = await (await rep(INSURANCE)).wantingOptions('u', NOW);
    expect(o.type).toEqual([]);
    expect(o.area).toEqual([]);
    expect(o.topic).toEqual(['Group life cover', 'Home contents cover', 'Motor and medical cover']);
    expect(o.timing).toEqual([{ value: 'this-month', label: 'Due this month' }, { value: 'this-quarter', label: 'Due this quarter' }]);
    expect(o.budget.map((b) => b.value)).toEqual(['under-1m']); // the 5K premium
  });

  it('a mixed rep sees both', async () => {
    const o = await (await rep({ ...PROPERTY, ...INSURANCE })).wantingOptions('u', NOW);
    expect(o.type).toEqual(['Villa']);
    expect(o.area).toEqual(['Mirdif']);
    expect(o.topic).toContain('Motor and medical cover');
    expect(o.timing.map((t) => t.value)).toEqual(['this-month', 'this-quarter']);
  });

  it('Topic and Timing filter within one need', async () => {
    const find = await rep({ ...PROPERTY, ...INSURANCE });
    const names = async (by: 'topic' | 'timing', value: string) => (await find.run('u', 'wanting', NOW, { by, value })).items.map((i) => i.clientName).sort();
    expect(await names('topic', 'Motor and medical cover')).toEqual(['Layla Nasser']);
    expect(await names('timing', 'this-month')).toEqual(['Layla Nasser']); // 31 Oct
    expect(await names('timing', 'this-quarter')).toEqual(['Karim Aziz', 'Layla Nasser']); // 31 Oct, 15 Nov
  });

  it('NEGATIVE: a year-less month is never a timing (no guessed year), and a past date is not "due"', async () => {
    const o = await (await rep({ 'Sara Khan': [{ text: 'Motor cover renewing in June', statedOn: '2026-10-01' }], 'Ali Raza': [{ text: 'Life cover renewal on 01/09/2026', statedOn: '2026-08-01' }] })).wantingOptions('u', NOW);
    // [P43 · owner] a year-less month is still never a dated timing (no "Due this month/quarter": no year guessed);
    // it is now the "Mentions June" display chip.
    expect(o.timing).toEqual([{ value: 'mentions-6', label: 'Mentions June' }]);
    expect(o.topic).toEqual(['Life cover', 'Motor cover']);
  });

  it('NEGATIVE: a property need never becomes a topic', async () => {
    expect((await (await rep(PROPERTY)).wantingOptions('u', NOW)).topic).toEqual([]);
  });
});
