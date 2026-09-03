import { describe, it, expect } from 'vitest';
import { RecallService, type RecallConfig } from './recall-service.js';
import { InMemoryRecallSessionRepository } from '../../adapters/recall/in-memory-recall-session-repository.js';
import type { Embedder } from '../../ports/embedder.js';
import type { NoteRepository, NoteRecord, SimilarNote } from '../../ports/note-repository.js';
import type { ModelClient, ModelMessage } from '../../ports/model.js';

const T = Date.parse('2026-07-09T09:00:00Z');
const MIN = 60 * 1000;
const cfg: RecallConfig = { topK: 5, minSimilarity: 0.2, maxRetrievalTokens: 100000, historyWindow: 20, sessionIdleMs: 30 * MIN };
const embedder: Embedder = { dimension: 8, embed: async () => [1, 0, 0, 0, 0, 0, 0, 0] };

function note(id: string, rawText: string): NoteRecord {
  return { id, userId: 'u', clientId: 'c1', source: 'paste', rawText, audioKey: null, status: 'extracted', sweepAttempts: 0, extracted: null, messages: null, createdAt: T };
}
function repo(matches: SimilarNote[]): NoteRepository {
  return { searchSimilarByUser: async () => matches } as unknown as NoteRepository;
}
function capturing() {
  let last: ModelMessage[] | null = null;
  const client: ModelClient = { complete: async (req) => { last = req.messages; return { text: 'ok', usage: { inputTokens: 10, outputTokens: 5 } }; } };
  return { client, last: (): ModelMessage[] => last ?? [] };
}
const oneMatch = repo([{ note: note('n1', 'the villa pricing was discussed'), similarity: 0.9 }]);

describe('[ASK-SESSION] the 20-message conversation window', () => {
  it('the first turn carries the directive + the question, and no history', async () => {
    const cap = capturing();
    const svc = new RecallService(embedder, oneMatch, cap.client, cfg, undefined, 'claude-haiku-4-5-20251001', new InMemoryRecallSessionRepository());
    await svc.ask('u', 'what about pricing?', T);
    const m = cap.last();
    expect(m).toHaveLength(1);
    expect(m[0]!.content).toContain('Answer only the latest question'); // the anti-recap directive
    expect(m[0]!.content).toContain('what about pricing?');
  });

  it('a follow-up within the session carries the prior exchange verbatim (so pronouns can resolve)', async () => {
    const cap = capturing();
    const sessions = new InMemoryRecallSessionRepository();
    const svc = new RecallService(embedder, oneMatch, cap.client, cfg, undefined, 'h', sessions);
    await svc.ask('u', 'what did they say about the villa?', T);
    await svc.ask('u', 'what about the other one?', T + MIN);
    const m = cap.last();
    expect(m).toHaveLength(3); // prior user + prior assistant + current
    expect(m[0]).toMatchObject({ role: 'user' });
    expect(m[0]!.content).toBe('what did they say about the villa?'); // stored raw, not the wrapped prompt
    expect(m[1]).toMatchObject({ role: 'assistant', content: 'ok' });
    expect(m[2]!.content).toContain('what about the other one?');
  });

  it('keeps only the last 20 messages (older turns drop out of the prompt)', async () => {
    const cap = capturing();
    const sessions = new InMemoryRecallSessionRepository();
    const svc = new RecallService(embedder, oneMatch, cap.client, cfg, undefined, 'h', sessions);
    for (let i = 0; i < 15; i++) await svc.ask('u', `q${i}`, T + i * MIN); // 30 messages
    await svc.ask('u', 'latest', T + 15 * MIN);
    const m = cap.last();
    expect(m).toHaveLength(21); // 20 history + the current turn
    expect(m.slice(0, 20).some((x) => x.content === 'q0')).toBe(false); // the oldest fell off
    expect(m.slice(0, 20).some((x) => x.content === 'q10')).toBe(true); // a recent one is retained
  });

  it('a turn after 30 minutes idle starts a fresh session (no carried history)', async () => {
    const cap = capturing();
    const sessions = new InMemoryRecallSessionRepository();
    const svc = new RecallService(embedder, oneMatch, cap.client, cfg, undefined, 'h', sessions);
    await svc.ask('u', 'first', T);
    await svc.ask('u', 'much later', T + 31 * MIN); // > 30 min → new session
    expect(cap.last()).toHaveLength(1); // fresh session, no history
    const dump = await sessions.exportForUser('u');
    expect(dump).toHaveLength(2); // two distinct sessions
  });

  it('the same question asked twice is answered twice, from fresh retrieval (no "I already told you")', async () => {
    const cap = capturing();
    const svc = new RecallService(embedder, oneMatch, cap.client, cfg, undefined, 'h', new InMemoryRecallSessionRepository());
    const r1 = await svc.ask('u', 'pricing?', T);
    const r2 = await svc.ask('u', 'pricing?', T + MIN);
    expect(r1.receipts).toHaveLength(1);
    expect(r2.receipts).toHaveLength(1); // re-retrieved, not short-circuited by history
  });

  it('history is NOT a source of truth: empty retrieval → "I don\'t have that", even mid-conversation', async () => {
    const cap = capturing();
    const sessions = new InMemoryRecallSessionRepository();
    const empty = new RecallService(embedder, repo([]), cap.client, cfg, undefined, 'h', sessions);
    await empty.ask('u', 'the villa is in Palm Jumeirah', T); // stated in conversation
    const { answer, receipts } = await empty.ask('u', 'where is the villa?', T + MIN);
    expect(answer).toMatch(/don't have that on record/i); // not answered from history
    expect(receipts).toEqual([]);
  });

  it('a session is included in export and removed on purge (account export + delete)', async () => {
    const sessions = new InMemoryRecallSessionRepository();
    const svc = new RecallService(embedder, oneMatch, capturing().client, cfg, undefined, 'h', sessions);
    await svc.ask('u', 'what about pricing?', T);
    const dump = await sessions.exportForUser('u');
    expect(dump).toHaveLength(1);
    expect(dump[0]!.messages).toHaveLength(2); // the rep's question + Tovira's reply, verbatim
    expect(dump[0]!.messages[0]).toMatchObject({ role: 'user', content: 'what about pricing?' });
    await sessions.purgeUser('u'); // what account delete calls
    expect(await sessions.exportForUser('u')).toHaveLength(0);
  });

  it('isolates sessions per rep', async () => {
    const sessions = new InMemoryRecallSessionRepository();
    const svc = new RecallService(embedder, oneMatch, capturing().client, cfg, undefined, 'h', sessions);
    await svc.ask('a', 'q', T);
    await svc.ask('b', 'q', T);
    expect(await sessions.exportForUser('a')).toHaveLength(1);
    expect((await sessions.exportForUser('a'))[0]!.messages.every((m) => m.content !== undefined)).toBe(true);
    expect(await sessions.exportForUser('b')).toHaveLength(1);
  });
});
