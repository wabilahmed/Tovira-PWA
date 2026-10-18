import { describe, it, expect } from 'vitest';
import { RecallService, RECALL_PROMPT_CHAR_CEILING } from './recall-service.js';
import { InMemoryRecallSessionRepository } from '../../adapters/recall/in-memory-recall-session-repository.js';
import type { ModelClient, ModelCompletionRequest } from '../../ports/model.js';
import type { Receipt } from './recall-service.js';

/** [P23-A2] Haiku 5.5 bills a whole request at 5x once its prompt passes 100,000 tokens. A character is
 *  at least one token's worth of text, so keeping the prompt under a CHARACTER ceiling keeps it under the
 *  token line. Excerpts are trimmed from the least relevant end first, then the oldest history. */
const prompt = (r: ModelCompletionRequest) => (r.system ?? '').length + r.messages.reduce((n, m) => n + m.content.length, 0);
const embedder = { dimension: 8, embed: async () => [1, 0, 0, 0, 0, 0, 0, 0] };
const none = { searchSimilarByUser: async () => [] } as never;

describe('[P23-A2] Ask stays under the Haiku 5.5 long-prompt line', () => {
  it('the ceiling is under 100,000 characters', () => expect(RECALL_PROMPT_CHAR_CEILING).toBeLessThanOrEqual(100_000));

  it('huge excerpts are trimmed until the whole prompt fits; the most relevant excerpt is kept', async () => {
    const seen: ModelCompletionRequest[] = [];
    const model: ModelClient = { complete: async (r) => { seen.push(r); return { text: 'ok' }; } };
    const rows: Receipt[] = Array.from({ length: 6 }, (_, i) => ({ quote: `R${i} ` + 'x'.repeat(30_000), date: '2026-04-01', clientId: 'c', noteId: `n${i}` }));
    const svc = new RecallService(embedder, none, model, { topK: 5, minSimilarity: 0.2, maxRetrievalTokens: 10_000_000 }, undefined, 'stub',
      undefined, undefined, undefined, undefined, undefined, undefined, { forUser: async () => rows });
    const out = await svc.ask('u', 'anything?');
    expect(prompt(seen[0]!)).toBeLessThanOrEqual(RECALL_PROMPT_CHAR_CEILING);
    expect(seen[0]!.messages.at(-1)!.content).toContain('R0 ');
    expect(out.receipts.length).toBeLessThan(6); // the receipts shown are the ones the model saw
    expect(out.receipts[0]!.noteId).toBe('n0');
  });

  it('a long conversation history is trimmed oldest-first when the excerpts alone are not enough', async () => {
    const seen: ModelCompletionRequest[] = [];
    const model: ModelClient = { complete: async (r) => { seen.push(r); return { text: 'ok' }; } };
    const sessions = new InMemoryRecallSessionRepository();
    const svc = new RecallService(embedder, none, model, { topK: 5, minSimilarity: 0.2, maxRetrievalTokens: 10_000_000, historyWindow: 50 }, undefined, 'stub',
      sessions, undefined, undefined, undefined, undefined, undefined, { forUser: async () => [{ quote: 'short fact', date: '2026-04-01', clientId: 'c', noteId: 'n' }] });
    const t0 = Date.parse('2026-10-18T09:00:00Z');
    for (let i = 0; i < 8; i++) await svc.ask('u', `q${i} ` + 'y'.repeat(15_000), t0 + i * 1000);
    const last = seen.at(-1)!;
    expect(prompt(last)).toBeLessThanOrEqual(RECALL_PROMPT_CHAR_CEILING);
    expect(last.messages.at(-1)!.content).toContain('short fact'); // the excerpt survives
    expect(last.messages.at(-1)!.content).toContain('q7 '); // and the current question
    expect(last.messages[0]!.role).toBe('user'); // trimmed by whole turns — still opens with the rep
  });

  it('NEGATIVE: a normal prompt is untouched', async () => {
    const seen: ModelCompletionRequest[] = [];
    const model: ModelClient = { complete: async (r) => { seen.push(r); return { text: 'ok' }; } };
    const rows: Receipt[] = [{ quote: 'a', date: '2026-04-01', clientId: 'c', noteId: 'n1' }, { quote: 'b', date: '2026-04-01', clientId: 'c', noteId: 'n2' }];
    const out = await new RecallService(embedder, none, model, undefined, undefined, 'stub', undefined, undefined, undefined, undefined, undefined, undefined, { forUser: async () => rows }).ask('u', 'q?');
    expect(out.receipts).toHaveLength(2);
  });
});
