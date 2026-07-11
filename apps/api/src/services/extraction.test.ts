import { describe, it, expect } from 'vitest';
import { extractFacts } from './extraction.js';
import { createModelClient } from '../container.js';
import { loadConfig } from '../config.js';
import { AnthropicModelClient } from '../adapters/model/anthropic.js';
import { ModelError } from '../ports/model.js';

// [P0-2] "Swap the AI implementation ... to a stub returning canned JSON via
// config only → extraction flow still runs, no code edits."
describe('extraction service (business logic over the ModelClient port)', () => {
  it('runs end-to-end against the stub selected purely by config', async () => {
    const config = loadConfig({ DATABASE_URL: 'x', MODEL_PROVIDER: 'stub' });
    const model = createModelClient(config);
    const result = await extractFacts(model, { transcript: 'quick catch-up, nothing to do', today: '2026-07-11' });
    expect(result.data).toBeTypeOf('object');
    expect(result.raw).toBeTypeOf('string');
  });

  it('accepts an injected stub with custom canned JSON (dependency inversion)', async () => {
    const canned = '{"promises":[{"text":"send quote"}],"summary":"ok"}';
    const model = { async complete() { return { text: canned }; } };
    const result = await extractFacts(model, { transcript: 'anything', today: '2026-07-11' });
    expect(result.data).toEqual({ promises: [{ text: 'send quote' }], summary: 'ok' });
  });

  // NEGATIVE: "Point the model interface at an unreachable endpoint → the
  // interface surfaces a TYPED error; the caller handles it (no unhandled crash
  // leaking vendor internals)."
  it('surfaces a typed ModelError to the caller when the model is unreachable', async () => {
    const model = new AnthropicModelClient({
      apiKey: 'test',
      baseUrl: 'http://127.0.0.1:1',
      model: 'claude-haiku-4-5-20251001',
      timeoutMs: 2000,
    });

    // The business-logic caller can handle it as a typed error — no raw crash.
    let handled: unknown;
    try {
      await extractFacts(model, { transcript: 'hi', today: '2026-07-11' });
    } catch (err) {
      handled = err;
    }
    expect(handled).toBeInstanceOf(ModelError);
    // The error message is a controlled string, not leaked vendor/undici internals.
    expect((handled as Error).message).toBe('model request failed');
  });
});
