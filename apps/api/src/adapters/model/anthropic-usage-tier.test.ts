import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicModelClient } from './anthropic.js';

afterEach(() => vi.unstubAllGlobals());

/** [P23-A2] The adapter reports how much of a cache write was at the 5-minute tier, so the meter prices
 *  each tier at its own rate (the API's usage.cache_creation breakdown). */
describe('[P23-A2] cache-write tier breakdown', () => {
  it('surfaces cache_creation.ephemeral_5m_input_tokens as cacheCreation5mInputTokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 5, output_tokens: 2, cache_creation_input_tokens: 900, cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 600 } },
    }), { status: 200 })));
    const res = await new AnthropicModelClient({ apiKey: 'k', baseUrl: 'http://api.test', model: 'claude-sonnet-5-5', effort: 'low' }).complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(res.usage?.cacheCreationInputTokens).toBe(900);
    expect(res.usage?.cacheCreation5mInputTokens).toBe(300);
  });
  it('absent breakdown → field absent (priced at the 1h rate, never under-billed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 5, output_tokens: 2, cache_creation_input_tokens: 900 } }), { status: 200 })));
    const res = await new AnthropicModelClient({ apiKey: 'k', baseUrl: 'http://api.test', model: 'claude-sonnet-5' }).complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(res.usage?.cacheCreation5mInputTokens).toBeUndefined();
  });
});
