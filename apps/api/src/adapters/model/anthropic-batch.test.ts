import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicBatchClient, AnthropicModelClient } from './anthropic.js';
import type { ModelCompletionRequest } from '../../ports/model.js';

/**
 * [P81-2 · owner, 21 Nov] Bulk and multi-file imports are read through the Message Batches API (half price). The
 * batch client is a ModelClient: every request made while a batch is gathering goes into ONE batch, sent with exactly
 * the params a live call sends; each caller gets its own result back, marked batch-priced. Anything the batch does
 * not return (an errored item, a failed submit, a batch still running at the deadline, which is then cancelled) is
 * read live instead, so an import always finishes.
 */
const OPTS = { apiKey: 'k', baseUrl: 'http://api', model: 'claude-sonnet-5' };
const req = (n: number): ModelCompletionRequest => ({ system: 'SYS', cacheSystemPrompt: true, cacheTtl: '1h', maxTokens: 32_000, messages: [{ role: 'user', content: `piece ${n}` }] });
const answer = (text: string) => ({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, output_tokens_details: { thinking_tokens: 40 } } });

type Item = { custom_id: string; params: { messages: Array<{ content: string }> } };
/** A fake API. `plan` decides each item's batch result; polls end the batch after `endsAfterPolls`. */
function api(o: { plan?: (piece: string) => 'ok' | 'errored'; submitStatus?: number; endsAfterPolls?: number } = {}) {
  const calls: Array<{ url: string; method: string; body?: unknown; headers: Record<string, string> }> = [];
  const batches = new Map<string, { items: Item[]; polls: number; cancelled: boolean }>(); let n = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });
    if (url === 'http://api/v1/messages/batches' && method === 'POST') {
      if (o.submitStatus) return json(o.submitStatus, { error: { type: 'overloaded_error' } });
      const id = `b${++n}`; batches.set(id, { items: body.requests, polls: 0, cancelled: false });
      return json(200, { id, processing_status: 'in_progress' });
    }
    const m = /\/(?:v1\/messages\/batches|results)\/(b\d+)(\/cancel)?$/.exec(url);
    if (m && m[2]) { batches.get(m[1]!)!.cancelled = true; return json(200, { id: m[1], processing_status: 'canceling' }); }
    if (m && url.includes('/v1/messages/batches/')) {
      const b = batches.get(m[1]!)!; b.polls += 1;
      const ended = b.cancelled || b.polls >= (o.endsAfterPolls ?? 1);
      return json(200, { id: m[1], processing_status: ended ? 'ended' : 'in_progress', ended_at: ended ? '2026-11-21T12:00:00Z' : null, results_url: ended ? `http://api/results/${m[1]}` : null });
    }
    if (m && url.includes('/results/')) {
      const { items, cancelled } = batches.get(m[1]!)!;
      const lines = items.map((it) => {
        const piece = it.params.messages[0]!.content;
        if (cancelled) return { custom_id: it.custom_id, result: { type: 'canceled' } };
        return (o.plan?.(piece) ?? 'ok') === 'ok'
          ? { custom_id: it.custom_id, result: { type: 'succeeded', message: answer(`batch ${piece}`) } }
          : { custom_id: it.custom_id, result: { type: 'errored', error: { type: 'invalid_request' } } };
      });
      return new Response(lines.map((l) => JSON.stringify(l)).join('\n'), { status: 200 });
    }
    if (url === 'http://api/v1/messages') return json(200, answer(`live ${body.messages[0].content}`));
    return json(404, {});
  }) as unknown as typeof fetch;
  vi.stubGlobal('fetch', fetchImpl); // the live fallback (AnthropicModelClient) reads through the same fake API
  return { fetchImpl, calls };
}
afterEach(() => { vi.unstubAllGlobals(); });
const client = (f: typeof fetch, extra: Partial<ConstructorParameters<typeof AnthropicBatchClient>[1]> = {}) =>
  new AnthropicBatchClient(new AnthropicModelClient(OPTS), { fetchImpl: f, gatherMs: 5, pollMs: 1, maxWaitMs: 1_000, sleep: async () => {}, ...extra });

describe('[P81-2] one batch for everything gathered, at half price', () => {
  it('requests made together go into ONE batch, with the exact params and headers of a live call', async () => {
    const a = api(); const c = client(a.fetchImpl);
    const out = await Promise.all([1, 2, 3].map((n) => c.complete(req(n))));
    const submits = a.calls.filter((x) => x.url.endsWith('/batches') && x.method === 'POST');
    expect(submits).toHaveLength(1);
    const live = new AnthropicModelClient(OPTS);
    expect((submits[0]!.body as { requests: Item[] }).requests.map((r) => r.params)).toEqual([1, 2, 3].map((n) => live.params(req(n))));
    expect(submits[0]!.headers['anthropic-beta']).toBe('extended-cache-ttl-2025-04-11'); // the 1-hour cache, as live
    expect(out.map((r) => r.text)).toEqual(['batch piece 1', 'batch piece 2', 'batch piece 3']);
    expect(a.calls.some((x) => x.url === 'http://api/v1/messages')).toBe(false); // nothing read live
  });
  it('each result carries its usage, its thinking tokens, and the batch-price mark', async () => {
    const a = api(); const r = await client(a.fetchImpl).complete(req(1));
    expect(r.usage).toMatchObject({ inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 1000, thinkingTokens: 40, batchDiscount: true });
    expect(r.stopReason).toBe('end_turn');
  });
  it('waits for the batch to end (polling), then answers', async () => {
    const a = api({ endsAfterPolls: 3 }); await client(a.fetchImpl).complete(req(1));
    expect(a.calls.filter((x) => x.url === 'http://api/v1/messages/batches/b1').length).toBe(3);
  });
  it('a request made after a batch was sent goes into the next batch', async () => {
    const a = api(); const c = client(a.fetchImpl);
    await c.complete(req(1)); await c.complete(req(2));
    expect(a.calls.filter((x) => x.url.endsWith('/batches') && x.method === 'POST')).toHaveLength(2);
  });
});

describe('[P81-2] NEGATIVE: an import always finishes', () => {
  it('an item the batch did not answer is read live (and is full price)', async () => {
    const a = api({ plan: (p) => (p === 'piece 2' ? 'errored' : 'ok') });
    const c = client(a.fetchImpl);
    const out = await Promise.all([1, 2].map((n) => c.complete(req(n))));
    expect(out.map((r) => r.text)).toEqual(['batch piece 1', 'live piece 2']);
    expect(out[1]!.usage?.batchDiscount).toBeUndefined();
  });
  it('a failed submit reads every gathered request live', async () => {
    const a = api({ submitStatus: 529 }); const c = client(a.fetchImpl);
    const out = await Promise.all([1, 2].map((n) => c.complete(req(n))));
    expect(out.map((r) => r.text)).toEqual(['live piece 1', 'live piece 2']);
  });
  it('a batch still running at the deadline is cancelled, and what it did not finish is read live', async () => {
    let t = 0;
    const a = api({ endsAfterPolls: 1_000 });
    const c = client(a.fetchImpl, { now: () => t, sleep: async () => { t += 400; }, maxWaitMs: 1_000 });
    const out = await c.complete(req(1));
    expect(a.calls.some((x) => x.url.endsWith('/cancel') && x.method === 'POST')).toBe(true);
    expect(out.text).toBe('live piece 1');
  });
  it('never puts more than maxPerBatch requests in one batch', async () => {
    const a = api(); const c = client(a.fetchImpl, { maxPerBatch: 2 });
    await Promise.all([1, 2, 3, 4, 5].map((n) => c.complete(req(n))));
    const sizes = a.calls.filter((x) => x.url.endsWith('/batches') && x.method === 'POST').map((x) => (x.body as { requests: unknown[] }).requests.length);
    expect(sizes).toEqual([2, 2, 1]);
  });
});
