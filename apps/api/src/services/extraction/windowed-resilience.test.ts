import { describe, it, expect } from 'vitest';
import { ExtractionService, OUTPUT_CEILING } from './extraction-service.js';
import { InMemoryClientRepository } from '../../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../../adapters/notes/in-memory-note-repository.js';
import { InMemoryFactsRepository } from '../../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../../adapters/logs/in-memory-extraction-log-repository.js';
import { StubEmbedder } from '../../adapters/embedding/stub.js';
import { AiGateRefused } from '../spend/ai-gate.js';
import type { ModelClient, ModelCompletionRequest } from '../../ports/model.js';
import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [P68-1/2/3 · owner, 19 Nov] Measured on a real 1,000-message chat: one piece spent all 20,000 output tokens on
 * thinking, so the whole chat failed and everything spent was lost; pieces were read one after another (15 minutes per
 * 1,000 messages). Now: the output ceiling is 32,000 (above any thinking measured); a failed piece is tried once more;
 * one piece that still fails never fails the chat (the rest are merged); pieces are read in parallel.
 */
const U = 'u-res';
const WIN = { enabled: true, threshold: 150, size: 120, overlap: 20 };

/** n messages; message i says "fact i" and message 50 of every hundred (read by one piece only, outside the overlap) is a client requirement the model extracts. */
function chat(n: number): ImportedMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    sender: i % 2 ? 'Khalid' : 'Wabil', role: i % 2 ? 'client' : 'rep', media: false,
    sentAt: `2026-03-${String(1 + Math.floor(i / 40)).padStart(2, '0')}T${String(8 + (i % 10)).padStart(2, '0')}:00`,
    body: i % 100 === 50 ? `We need parking space number ${i}` : `general chat ${i}`,
  } as ImportedMessage));
}

type Behaviour = 'ok' | 'garbage' | 'starved' | 'throw' | 'refuse';
/** A model whose answer depends on the piece (its first message number) and the attempt; tracks parallelism. */
function model(plan: (piece: number, attempt: number) => Behaviour, seen: ModelCompletionRequest[], live: { now: number; max: number }): ModelClient {
  const attempts = new Map<number, number>();
  return {
    complete: async (req) => {
      seen.push(req);
      const text = req.messages[0]!.content;
      const first = Number(/(?:general chat|parking space number) (\d+)/.exec(text)?.[1] ?? -1);
      const piece = Math.floor(first / 100);
      const attempt = (attempts.get(piece) ?? 0) + 1;
      attempts.set(piece, attempt);
      live.now += 1; live.max = Math.max(live.max, live.now);
      await new Promise((r) => setTimeout(r, 5));
      live.now -= 1;
      const b = plan(piece, attempt);
      if (b === 'refuse') throw new AiGateRefused('account_limit');
      if (b === 'throw') throw new Error('provider 529');
      if (b === 'garbage') return { text: 'not json', usage: { inputTokens: 10, outputTokens: 5 } };
      if (b === 'starved') return { text: '', stopReason: 'max_tokens', usage: { inputTokens: 10, outputTokens: 20_000, thinkingTokens: 19_994 } };
      const reqs = [...text.matchAll(/We need parking space number (\d+)/g)].map((m) => ({ text: `Parking space ${m[1]}`, requirement_raw: `We need parking space number ${m[1]}`, stated_on: null, confidence: 'high' }));
      return { text: JSON.stringify({ summary: 's', promises: [], people: [], personal_facts: [], key_dates: [], concerns: [], next_steps: [], requirements: reqs, meeting: null }), usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
}

async function run(n: number, plan: (piece: number, attempt: number) => Behaviour, concurrency?: number) {
  const clients = new InMemoryClientRepository(); const notes = new InMemoryNoteRepository();
  const seen: ModelCompletionRequest[] = []; const live = { now: 0, max: 0 };
  const svc = new ExtractionService(model(plan, seen, live), clients, notes, new InMemoryFactsRepository(), new StubEmbedder(8), new InMemoryExtractionLogRepository(), 'stub',
    undefined, undefined, undefined, '1h', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    { ...WIN, ...(concurrency ? { concurrency } : {}) });
  const client = await clients.create(U, 'Khalid');
  const messages = chat(n);
  const note = await notes.create(U, { clientId: client.id, source: 'whatsapp_export', rawText: 'x', audioKey: null, status: 'pending_extraction', messages });
  const out = await svc.extractNote(U, note.id, '2026-04-01');
  const stored = (await notes.findByIdForUser(U, note.id))!;
  const reqs = ((stored.extracted as { requirements?: Array<{ text: string }> } | null)?.requirements ?? []).map((r) => r.text);
  return { out, stored, reqs, seen, live };
}

describe('[P68-1] the output ceiling is above any thinking measured', () => {
  it('every extraction call asks for 32,000 output tokens (was 20,000, where a piece starved)', async () => {
    const r = await run(1000, () => 'ok');
    expect(OUTPUT_CEILING).toBe(32_000);
    expect(r.seen.every((q) => q.maxTokens === 32_000)).toBe(true);
  });
});

describe('[P68-2] a failed piece is tried once more, and never fails the chat', () => {
  it('a starved piece is retried once and, answering the second time, is kept: the chat is whole', async () => {
    const r = await run(1000, (p, a) => (p === 3 && a === 1 ? 'starved' : 'ok'));
    expect(r.out.status).not.toBe('needs_review');
    expect(r.reqs).toHaveLength(10); // every piece's requirement, piece 3's included
    expect(r.seen).toHaveLength(11); // 10 pieces + the one retry
  });
  it('a piece that fails twice is left out; the other pieces are merged (not needs_review)', async () => {
    const r = await run(1000, (p) => (p === 3 ? 'garbage' : 'ok'));
    expect(r.stored.status).not.toBe('needs_review');
    expect(r.reqs).toHaveLength(9);
    expect(r.reqs).not.toContain('Parking space 350');
    expect(r.seen.filter((q) => q.messages[0]!.content.includes('parking space number 350'))).toHaveLength(2); // tried twice, no more
  });
  it('a provider error on a piece is retried the same way', async () => {
    const r = await run(1000, (p, a) => (p === 7 && a === 1 ? 'throw' : 'ok'));
    expect(r.reqs).toHaveLength(10);
  });
  it('NEGATIVE: every piece failing is still needs_review, nothing stored', async () => {
    const r = await run(1000, () => 'garbage');
    expect(r.stored.status).toBe('needs_review');
    expect(r.reqs).toEqual([]);
  });
  it('NEGATIVE: the usage gate refusing (the cap, the AI pause) still stops the chat whole: re-queued, nothing saved, no retry', async () => {
    const r = await run(1000, (p) => (p === 2 ? 'refuse' : 'ok'));
    expect(r.out.status).toBe('spend_capped');
    expect(r.stored.status).toBe('pending_extraction');
    expect(r.stored.extracted ?? null).toBeNull();
    expect(r.seen.length).toBeLessThan(10); // nothing new started after the refusal
  });
});

describe('[P68-3] pieces are read in parallel', () => {
  it('with concurrency 4, up to 4 pieces are in flight at once, and the merge is the same as one at a time', async () => {
    const serial = await run(1000, () => 'ok', 1);
    const parallel = await run(1000, () => 'ok', 4);
    expect(serial.live.max).toBe(1);
    expect(parallel.live.max).toBe(4);
    expect(parallel.reqs).toEqual(serial.reqs); // merged in piece order, whatever order they finished in
    expect(parallel.seen).toHaveLength(10);
  });
  it('NEGATIVE: never more lanes than pieces', async () => {
    const r = await run(160, () => 'ok', 8); // 2 pieces
    expect(r.live.max).toBe(2);
  });
});
