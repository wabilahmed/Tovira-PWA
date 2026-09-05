import { describe, it, expect } from 'vitest';
import { InMemoryRequirementRepository } from './in-memory-requirement-repository.js';
import type { RequirementInput } from '../../ports/requirement-repository.js';

const req = (text: string, embedding: number[] | null = [1, 0, 0]): RequirementInput => ({
  text,
  requirementRaw: text,
  statedOn: '2026-07-09',
  confidence: 'high',
  embedding,
});

describe('[INV-MATCH] InMemoryRequirementRepository', () => {
  it('saves a note\'s requirements as rows and is idempotent per note (re-save replaces)', async () => {
    const r = new InMemoryRequirementRepository();
    await r.saveForNote('u', 'note1', 'c1', [req('a 2-bed'), req('a villa')]);
    expect(await r.listByClient('u', 'c1')).toHaveLength(2);
    // Re-extraction of the same note replaces its rows, never duplicates.
    await r.saveForNote('u', 'note1', 'c1', [req('a 2-bed')]);
    expect(await r.listByClient('u', 'c1')).toHaveLength(1);
  });

  it('lists only OPEN requirements as the matchable set', async () => {
    const r = new InMemoryRequirementRepository();
    const [a, b] = await r.saveForNote('u', 'n', 'c1', [req('x'), req('y')]);
    await r.setStatus('u', b!.id, 'met');
    const open = await r.listOpenByUser('u');
    expect(open.map((x) => x.id)).toEqual([a!.id]);
  });

  it('searchByEmbedding ranks open requirements by cosine and skips vector-less / non-open ones', async () => {
    const r = new InMemoryRequirementRepository();
    await r.saveForNote('u', 'n', 'c1', [
      req('near', [1, 0, 0]),
      req('far', [0, 1, 0]),
      req('novec', null), // no vector → never matchable
    ]);
    const hits = await r.searchByEmbedding('u', [1, 0, 0], 10);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.requirement.text).toBe('near');
    expect(hits[0]!.similarity).toBeCloseTo(1);
    expect(hits[1]!.requirement.text).toBe('far');
  });

  it('marks stale open requirements dormant, and a fresh mention revives one', async () => {
    const r = new InMemoryRequirementRepository();
    const [a] = await r.saveForNote('u', 'n', 'c1', [req('x')]);
    const moved = await r.markDormantBefore('u', Date.now() + 1_000_000); // everything older than "way future"
    expect(moved).toBe(1);
    expect((await r.findByIdForUser('u', a!.id))!.status).toBe('dormant');
    expect(await r.listOpenByUser('u')).toHaveLength(0); // dormant → not matchable
    // A fresh mention revives it.
    await r.markMentioned('u', a!.id, Date.now() + 2_000_000);
    expect((await r.findByIdForUser('u', a!.id))!.status).toBe('open');
  });

  it('is tenant-isolated — one rep never sees another\'s requirements', async () => {
    const r = new InMemoryRequirementRepository();
    await r.saveForNote('rep-A', 'n', 'c1', [req('secret')]);
    expect(await r.listOpenByUser('rep-B')).toHaveLength(0);
    expect(await r.searchByEmbedding('rep-B', [1, 0, 0], 10)).toHaveLength(0);
  });
});
