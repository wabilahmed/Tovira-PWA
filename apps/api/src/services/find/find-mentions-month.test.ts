import { describe, it, expect } from 'vitest';
import { FindService } from './find-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryRequirementRepository } from '../../adapters/requirements/in-memory-requirement-repository.js';

/**
 * [P43-6 · owner] A month said with no day and no year ("renewal in June") shows in Timing as a "Mentions June" chip,
 * exactly as said. No year is inferred and no date is stored: it is a display grouping only, and each row carries
 * the receipt of the need that mentions it. A dated need ("12 June 2026") goes under dated Timing, never "Mentions".
 */
type Need = { text: string; raw?: string; statedOn: string };
async function rep(needs: Record<string, Need[]>) {
  const clients = new InMemoryClientRepository();
  const requirements = new InMemoryRequirementRepository();
  let n = 0;
  for (const [name, list] of Object.entries(needs)) {
    const c = await clients.create('u', name);
    await requirements.saveForNote('u', `n${n++}`, c.id, list.map((x) => ({ text: x.text, requirementRaw: x.raw ?? x.text, statedOn: x.statedOn, confidence: 'high' as const, embedding: null })));
  }
  const find = new FindService({ clients, facts: new InMemoryFactsRepository(), notes: new InMemoryNoteRepository(), requirements, hero: { risk: async () => [] }, coldThresholdDays: 30, promiseStaleThresholdDays: 90 });
  return { find, requirements };
}
const OCT = Date.parse('2026-10-25T09:00:00Z');

describe('[P43-6] Timing: "Mentions June"', () => {
  it('"renewal in June" → a "Mentions June" chip, and the filter finds that client with the need\'s own receipt', async () => {
    const { find } = await rep({ 'Layla Nasser': [{ text: 'Motor and medical cover renewing in June', raw: 'renewal is in June, last year the excess was too high', statedOn: '2026-01-20' }] });
    const o = await find.wantingOptions('u', OCT);
    expect(o.timing).toEqual([{ value: 'mentions-6', label: 'Mentions June' }]);
    const r = await find.run('u', 'wanting', OCT, { by: 'timing', value: 'mentions-6' });
    expect(r.items.map((i) => i.clientName)).toEqual(['Layla Nasser']);
    expect(r.items[0]!.receipt).toMatchObject({ quote: 'renewal is in June, last year the excess was too high', at: '2026-01-20' });
  });

  it('the chip says the month exactly as said', async () => {
    const { find } = await rep({ 'Ali Raza': [{ text: 'Group life review in Sept', statedOn: '2026-02-01' }] });
    expect((await find.wantingOptions('u', OCT)).timing).toEqual([{ value: 'mentions-9', label: 'Mentions Sept' }]);
  });

  it('NEGATIVE: no stored date changes: the need is read, never written', async () => {
    const { find, requirements } = await rep({ 'Layla Nasser': [{ text: 'Motor cover renewing in June', statedOn: '2026-01-20' }] });
    const before = JSON.stringify(await requirements.listOpenByUser('u'));
    await find.wantingOptions('u', OCT);
    await find.run('u', 'wanting', OCT, { by: 'timing', value: 'mentions-6' });
    expect(JSON.stringify(await requirements.listOpenByUser('u'))).toBe(before);
    expect(before).not.toMatch(/2026-06|2027-06/); // no June date anywhere
  });

  it('NEGATIVE: a rep with no month mentions sees no month chips', async () => {
    const { find } = await rep({ 'Karim Aziz': [{ text: 'Group life cover for 40 staff', statedOn: '2026-10-02' }], 'Hana Saleh': [{ text: 'Revised SLA', statedOn: '2026-10-02' }] });
    expect((await find.wantingOptions('u', OCT)).timing.filter((t) => t.value.startsWith('mentions-'))).toEqual([]);
  });

  it('NEGATIVE: "12 June 2026" goes under dated Timing, not "Mentions"', async () => {
    const JUNE = Date.parse('2026-06-02T09:00:00Z');
    const { find } = await rep({ 'Omar Haddad': [{ text: 'Policy renewal on 12 June 2026', statedOn: '2026-05-20' }] });
    const o = await find.wantingOptions('u', JUNE);
    expect(o.timing.map((t) => t.value)).toEqual(['this-month', 'this-quarter']);
    expect(o.timing.some((t) => t.label.startsWith('Mentions'))).toBe(false);
  });

  it('NEGATIVE: a day and month without a year ("12 June") is not a month-only mention', async () => {
    const { find } = await rep({ 'Omar Haddad': [{ text: 'Policy renewal on 12 June', statedOn: '2026-05-20' }] });
    expect((await find.wantingOptions('u', OCT)).timing).toEqual([]);
  });
});
