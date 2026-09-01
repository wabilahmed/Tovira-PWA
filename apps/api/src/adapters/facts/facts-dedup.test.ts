import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryFactsRepository } from './in-memory-facts-repository.js';
import { normalizePromiseText } from './dedupe.js';
import type { ExtractedPromise } from '../../services/extraction/types.js';

const P = (text: string, over: Partial<ExtractedPromise> = {}): ExtractedPromise => ({
  text,
  owner: 'rep',
  due_date: null,
  due_raw: null,
  confidence: 'high',
  ...over,
});
const U = 'user-1';
const C = 'client-1';

// B2-9: near-duplicate notes of ONE commitment must not become two promises. Dedup is
// WRITE-TIME (spine), so the commitment exists once across every surface. Match is STRICT
// (same client + owner + normalized-exact text) to never merge two distinct commitments.
describe('[B2-9] cross-note promise dedup (write-time, strict)', () => {
  let facts: InMemoryFactsRepository;
  beforeEach(() => {
    facts = new InMemoryFactsRepository();
  });

  it('normalizes only cosmetically (case, whitespace, trailing punctuation)', () => {
    expect(normalizePromiseText('  Send   the SOW.  ')).toBe('send the sow');
    expect(normalizePromiseText('Send the SOW')).toBe(normalizePromiseText('send the sow.'));
    expect(normalizePromiseText('Send the pricing sheet')).not.toBe(normalizePromiseText('Send the pricing sheet for the Dubai site'));
  });

  it('collapses the same commitment from two notes into ONE tracker row', async () => {
    await facts.saveExtraction(U, { noteId: 'n1', clientId: C, promises: [P('Send the integration timeline')] });
    await facts.saveExtraction(U, { noteId: 'n2', clientId: C, promises: [P('send the integration timeline.')] }); // case + trailing dot → equal
    expect(await facts.listPromisesByUser(U)).toHaveLength(1);
    // link, don't discard: BOTH notes still resolve to the commitment (receipt trail)
    expect(await facts.listPromisesByNote(U, 'n1')).toHaveLength(1);
    expect(await facts.listPromisesByNote(U, 'n2')).toHaveLength(1);
  });

  it('specific date wins on merge (a null date is upgraded by the duplicate)', async () => {
    await facts.saveExtraction(U, { noteId: 'n1', clientId: C, promises: [P('Send the SOW', { due_date: null, due_raw: null })] });
    await facts.saveExtraction(U, { noteId: 'n2', clientId: C, promises: [P('Send the SOW', { due_date: '2026-09-03', due_raw: 'Thursday' })] });
    const [p] = await facts.listPromisesByUser(U);
    expect(p!.dueDate).toBe('2026-09-03');
    expect(p!.dueRaw).toBe('Thursday');
  });

  it('does NOT merge distinct commitments with similar phrasing (the mirror-risk guard)', async () => {
    await facts.saveExtraction(U, { noteId: 'n1', clientId: C, promises: [P('Send the pricing sheet')] });
    await facts.saveExtraction(U, { noteId: 'n2', clientId: C, promises: [P('Send the pricing sheet for the Dubai site')] });
    expect(await facts.listPromisesByUser(U)).toHaveLength(2);
  });

  it('different owner or client stays distinct', async () => {
    await facts.saveExtraction(U, { noteId: 'n1', clientId: C, promises: [P('Send the deck', { owner: 'rep' })] });
    await facts.saveExtraction(U, { noteId: 'n2', clientId: C, promises: [P('Send the deck', { owner: 'client' })] });
    await facts.saveExtraction(U, { noteId: 'n3', clientId: 'client-2', promises: [P('Send the deck', { owner: 'rep' })] });
    expect(await facts.listPromisesByUser(U)).toHaveLength(3);
  });

  it('re-extracting the canonical note keeps exactly one tracker row (survivor promoted)', async () => {
    await facts.saveExtraction(U, { noteId: 'n1', clientId: C, promises: [P('Send the timeline')] });
    await facts.saveExtraction(U, { noteId: 'n2', clientId: C, promises: [P('Send the timeline')] });
    expect(await facts.listPromisesByUser(U)).toHaveLength(1);
    await facts.saveExtraction(U, { noteId: 'n1', clientId: C, promises: [P('Send the timeline')] }); // re-extract the original
    expect(await facts.listPromisesByUser(U)).toHaveLength(1);
    expect(await facts.listPromisesByNote(U, 'n1')).toHaveLength(1);
    expect(await facts.listPromisesByNote(U, 'n2')).toHaveLength(1);
  });

  it('a DONE commitment is not a merge target — a later identical promise is a new one', async () => {
    await facts.saveExtraction(U, { noteId: 'n1', clientId: C, promises: [P('Send the invoice')] });
    const [first] = await facts.listPromisesByUser(U);
    await facts.markPromiseDone(U, first!.id);
    await facts.saveExtraction(U, { noteId: 'n2', clientId: C, promises: [P('Send the invoice')] });
    expect((await facts.listPromisesByUser(U)).filter((x) => !x.done)).toHaveLength(1);
  });
});
