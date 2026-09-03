import { describe, it, expect, vi } from 'vitest';
import { RecallService } from './recall-service.js';
import type { Embedder } from '../../ports/embedder.js';
import type { NoteRepository, NoteRecord, SimilarNote } from '../../ports/note-repository.js';
import type { ModelClient } from '../../ports/model.js';
import { RecallMetrics } from '../metrics/recall-metrics.js';

const embedder: Embedder = { dimension: 8, embed: async () => [1, 0, 0, 0, 0, 0, 0, 0] };
const model = (text: string): ModelClient => ({ complete: async () => ({ text }) });

function note(id: string, rawText: string): NoteRecord {
  return { id, userId: 'u1', clientId: 'c1', source: 'paste', rawText, audioKey: null, status: 'extracted', sweepAttempts: 0, extracted: null, messages: null, createdAt: Date.parse('2026-01-16T10:00:00Z') };
}

function notesRepo(matches: SimilarNote[]): NoteRepository {
  return {
    searchSimilarByUser: vi.fn().mockResolvedValue(matches),
  } as unknown as NoteRepository;
}

describe('RecallService (P4-8)', () => {
  it('answers from a relevant note and cites a verbatim receipt with its date', async () => {
    const n = note('n1', 'Ahmed said the pricing is too high for the villas.');
    const repo = notesRepo([{ note: n, similarity: 0.9 }]);
    const svc = new RecallService(embedder, repo, model('Ahmed felt the pricing was too high.'));
    const { answer, receipts } = await svc.ask('u1', 'What did Ahmed say about pricing?');
    expect(answer).toMatch(/pricing/i);
    expect(receipts).toHaveLength(1);
    expect(n.rawText!).toContain(receipts[0]!.quote); // verbatim — a substring of the stored note
    expect(receipts[0]!.date).toBe('2026-01-16');
  });

  // [RECALL-METRICS] recall used to discard res.usage entirely — now each turn's cost is recorded.
  it('records the turn cost + shape (single-shot today: turn 1, no history)', async () => {
    const n = note('n1', 'Ahmed said the pricing is too high.');
    const repo = notesRepo([{ note: n, similarity: 0.9 }]);
    const withUsage: ModelClient = { complete: async () => ({ text: 'ok', usage: { inputTokens: 400, outputTokens: 120, cacheReadInputTokens: 0 } }) };
    const metrics = new RecallMetrics();
    const svc = new RecallService(embedder, repo, withUsage, { topK: 5, minSimilarity: 0.2 }, metrics, 'claude-haiku-4-5-20251001');
    await svc.ask('u1', 'pricing?');
    const s = metrics.snapshot();
    expect(s.turns).toBe(1);
    expect(s.curve[1]?.calls).toBe(1);
    expect(s.curve[1]!.avgInputTokens).toBe(400);
    expect(s.curve[1]!.avgHistoryTokens).toBe(0); // stateless
    expect(s.curve[1]!.avgRetrievalTokens).toBeGreaterThan(0);
    expect(metrics.perUserRollingAed('u1')).toBeGreaterThan(0); // Haiku: (400·1 + 120·5)/1e6 · 3.6725
  });

  // TRUST RULE: nothing relevant → honest "I don't have that", no fabrication.
  it('says "I don\'t have that" when retrieval is empty', async () => {
    const svc = new RecallService(embedder, notesRepo([]), model('SHOULD NOT BE USED'));
    const { answer, receipts } = await svc.ask('u1', 'What did we agree on Mars?');
    expect(answer).toMatch(/don't have that on record/i);
    expect(receipts).toEqual([]);
  });

  // TRUST RULE: matches below the similarity threshold are not treated as relevant.
  it('says "I don\'t have that" when the best match is below threshold', async () => {
    const repo = notesRepo([{ note: note('n1', 'unrelated chatter'), similarity: 0.05 }]);
    const svc = new RecallService(embedder, repo, model('x'), { topK: 5, minSimilarity: 0.3 });
    const { answer, receipts } = await svc.ask('u1', 'pricing?');
    expect(answer).toMatch(/don't have that on record/i);
    expect(receipts).toEqual([]);
  });

  // COST GUARD: retrieval is capped at top-k — never an unbounded read.
  it('caps retrieval at top-k', async () => {
    const repo = notesRepo([{ note: note('n1', 'x pricing'), similarity: 0.9 }]);
    const svc = new RecallService(embedder, repo, model('a'), { topK: 3, minSimilarity: 0.2 });
    await svc.ask('u1', 'pricing?');
    expect(repo.searchSimilarByUser).toHaveBeenCalledWith('u1', expect.any(Array), 3);
  });

  it('never fabricates an answer even if the model errors — falls back to receipts', async () => {
    const repo = notesRepo([{ note: note('n1', 'the pricing note'), similarity: 0.9 }]);
    const badModel: ModelClient = { complete: async () => { throw new Error('model down'); } };
    const svc = new RecallService(embedder, repo, badModel);
    const { answer, receipts } = await svc.ask('u1', 'pricing?');
    expect(receipts).toHaveLength(1); // the verbatim receipt still stands
    expect(answer).not.toMatch(/undefined/);
  });

  it('returns no answer for an empty question', async () => {
    const svc = new RecallService(embedder, notesRepo([]), model('x'));
    expect((await svc.ask('u1', '   ')).receipts).toEqual([]);
  });
});
