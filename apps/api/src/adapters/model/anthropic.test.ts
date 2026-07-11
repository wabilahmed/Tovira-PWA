import { describe, it, expect } from 'vitest';
import { AnthropicModelClient } from './anthropic.js';
import { ModelError } from '../../ports/model.js';

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
});
