import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicModelClient } from './anthropic.js';
import { ModelError } from '../../ports/model.js';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown): Array<{ url: string; init: RequestInit }> {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return calls;
}
const client = () => new AnthropicModelClient({ apiKey: 'k', baseUrl: 'http://api.test', model: 'claude-sonnet-5' });
const sentBody = (calls: Array<{ init: RequestInit }>) => JSON.parse(String(calls[0]!.init.body));

// [P0-2 negative] The concrete HTTP model adapter must convert transport
// failures into a typed ModelError with a controlled message — never leak
// vendor/undici internals or crash unhandled.
describe('AnthropicModelClient', () => {
  it('throws a typed ModelError when the endpoint is unreachable', async () => {
    const client = new AnthropicModelClient({
      apiKey: 'test',
      baseUrl: 'http://127.0.0.1:1',
      model: 'claude-haiku-4-5-20251001',
      timeoutMs: 2000,
    });
    const err = await client.complete({ messages: [{ role: 'user', content: 'hi' }] }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as Error).message).toBe('model request failed');
  });

  it('preserves the underlying failure as `cause` for diagnostics without leaking it to the message', async () => {
    const client = new AnthropicModelClient({
      apiKey: 'test',
      baseUrl: 'http://127.0.0.1:1',
      model: 'm',
      timeoutMs: 2000,
    });
    const err = (await client.complete({ messages: [{ role: 'user', content: 'hi' }] }).catch((e) => e)) as ModelError;
    expect(err.cause).toBeDefined();
    expect(err.message).not.toMatch(/ECONNREFUSED|undici|fetch failed/i);
  });

  // [CACHE] The breakpoint that actually turns Anthropic/Bedrock prompt caching
  // ON: cacheSystemPrompt sends `system` as a content-block array with
  // cache_control: ephemeral. Without it, the prefix is never cached.
  describe('prompt caching', () => {
    const ok = { content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 4096 } };

    it('sends cache_control on the system block when cacheSystemPrompt is set (5-min default)', async () => {
      const calls = stubFetch(ok);
      await client().complete({ system: 'BIG PREFIX', cacheSystemPrompt: true, messages: [{ role: 'user', content: 'x' }] });
      const body = sentBody(calls);
      expect(Array.isArray(body.system)).toBe(true);
      expect(body.system[0]).toEqual({ type: 'text', text: 'BIG PREFIX', cache_control: { type: 'ephemeral' } });
      // No extended-TTL beta header on the default (5-minute) path.
      expect((calls[0]!.init.headers as Record<string, string>)['anthropic-beta']).toBeUndefined();
    });

    it("the 1-hour tier sets ttl:'1h' AND the extended-cache beta header", async () => {
      const calls = stubFetch(ok);
      await client().complete({ system: 'BIG PREFIX', cacheSystemPrompt: true, cacheTtl: '1h', messages: [{ role: 'user', content: 'x' }] });
      expect(sentBody(calls).system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
      expect((calls[0]!.init.headers as Record<string, string>)['anthropic-beta']).toBe('extended-cache-ttl-2025-04-11');
    });

    it("the explicit 5-minute tier sets no ttl and no beta header", async () => {
      const calls = stubFetch(ok);
      await client().complete({ system: 'p', cacheSystemPrompt: true, cacheTtl: '5m', messages: [{ role: 'user', content: 'x' }] });
      expect(sentBody(calls).system[0].cache_control).toEqual({ type: 'ephemeral' });
      expect((calls[0]!.init.headers as Record<string, string>)['anthropic-beta']).toBeUndefined();
    });

    it("never sends the extended-cache beta header when caching is off, even if a ttl leaks in", async () => {
      const calls = stubFetch(ok);
      await client().complete({ system: 'p', cacheTtl: '1h', messages: [{ role: 'user', content: 'x' }] });
      expect((calls[0]!.init.headers as Record<string, string>)['anthropic-beta']).toBeUndefined();
      expect(sentBody(calls).system).toBe('p'); // plain string — not cached
    });

    it('leaves system as a plain string when caching is off (backward compatible)', async () => {
      const calls = stubFetch(ok);
      await client().complete({ system: 'BIG PREFIX', messages: [{ role: 'user', content: 'x' }] });
      expect(sentBody(calls).system).toBe('BIG PREFIX');
    });

    it('parses cache_read / cache_creation usage so a cache hit is provable', async () => {
      stubFetch({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 30, output_tokens: 5, cache_creation_input_tokens: 5000, cache_read_input_tokens: 4096 } });
      const res = await client().complete({ system: 'p', cacheSystemPrompt: true, messages: [{ role: 'user', content: 'x' }] });
      expect(res.usage?.cacheReadInputTokens).toBe(4096);
      expect(res.usage?.cacheCreationInputTokens).toBe(5000);
    });

    it('omits cache usage fields when the provider does not report them', async () => {
      stubFetch({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 30, output_tokens: 5 } });
      const res = await client().complete({ messages: [{ role: 'user', content: 'x' }] });
      expect(res.usage?.cacheReadInputTokens).toBeUndefined();
      expect(res.usage?.cacheCreationInputTokens).toBeUndefined();
    });
  });
});
