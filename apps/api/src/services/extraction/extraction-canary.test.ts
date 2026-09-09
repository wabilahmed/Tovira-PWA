import { describe, it, expect } from 'vitest';
import { ExtractionCanaryService, ExtractionCanaryError } from './extraction-canary.js';
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_MAX_TOKENS } from './prompt.js';
import type { ModelClient, ModelCompletionRequest, ModelCompletionResponse } from '../../ports/model.js';

/** A fake model whose response (and a spy on the request it received) the test controls. */
function fakeModel(res: Partial<ModelCompletionResponse>): { model: ModelClient; last: () => ModelCompletionRequest | null } {
  let last: ModelCompletionRequest | null = null;
  return {
    last: () => last,
    model: {
      async complete(req: ModelCompletionRequest): Promise<ModelCompletionResponse> {
        last = req;
        return { text: '', ...res };
      },
    },
  };
}

const HEALTHY: Partial<ModelCompletionResponse> = {
  text: '{"summary":"ok","promises":[],"people":[]}',
  stopReason: 'end_turn',
  usage: { inputTokens: 10_500, outputTokens: 3_600, thinkingTokens: 3_200 },
};

describe('[EXTRACT-CANARY] daily extraction canary', () => {
  it('passes when a real text block comes back (end_turn)', async () => {
    const { model } = fakeModel(HEALTHY);
    const canary = new ExtractionCanaryService(model);
    const result = await canary.run();
    expect(result.ok).toBe(true);
    expect(result.stopReason).toBe('end_turn');
    expect(result.textLength).toBeGreaterThan(0);
    // Reports the reasoning headroom so APPROACHING decay is visible before it breaks.
    expect(result.thinkingTokens).toBe(3_200);
    expect(result.headroomTokens).toBe(EXTRACTION_MAX_TOKENS - 3_600);
  });

  it('mirrors the PRODUCTION extraction call exactly — else it certifies nothing', async () => {
    const { model, last } = fakeModel(HEALTHY);
    await new ExtractionCanaryService(model).run();
    const req = last()!;
    expect(req.system).toBe(EXTRACTION_SYSTEM_PROMPT);
    expect(req.maxTokens).toBe(EXTRACTION_MAX_TOKENS);
    expect(req.cacheSystemPrompt).toBe(true);
    expect(req.cacheTtl).toBe('1h');
    // The probe is representative — big enough to provoke real reasoning (a one-liner would have
    // sailed through the 2,048 breakage). Assert it isn't trivially short.
    expect(req.messages[0]!.content.length).toBeGreaterThan(400);
  });

  it('does NOT bill a rep — no userId attribution on the canary call', async () => {
    const { model, last } = fakeModel(HEALTHY);
    await new ExtractionCanaryService(model).run();
    expect(last()!.userId).toBeUndefined();
  });

  it('FAILS LOUD when the budget is starved — max_tokens with no text (the exact regression)', async () => {
    const { model } = fakeModel({ text: '', stopReason: 'max_tokens', usage: { inputTokens: 10_500, outputTokens: 20_000, thinkingTokens: 20_000 } });
    const canary = new ExtractionCanaryService(model);
    await expect(canary.run()).rejects.toBeInstanceOf(ExtractionCanaryError);
  });

  it('FAILS LOUD on a thinking-only / empty-text response even if stop_reason looks normal', async () => {
    const { model } = fakeModel({ text: '   ', stopReason: 'end_turn', usage: { inputTokens: 10_500, outputTokens: 5_000, thinkingTokens: 5_000 } });
    await expect(new ExtractionCanaryService(model).run()).rejects.toBeInstanceOf(ExtractionCanaryError);
  });

  it('names a TRANSPORT failure (timeout/abort) instead of an opaque "model request failed"', async () => {
    // The first prod failure was a 30s abort surfaced only as "model request failed" — the canary
    // must diagnose it. ModelError carries the abort as `cause`.
    const model: ModelClient = { async complete() { const e = new Error('model request failed') as Error & { cause?: unknown }; e.cause = Object.assign(new Error('aborted'), { name: 'AbortError' }); throw e; } };
    try {
      await new ExtractionCanaryService(model).run();
      expect.unreachable('canary should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ExtractionCanaryError);
      expect((err as Error).message).toMatch(/timed out|aborted/);
      // never leaks the raw transport message
      expect((err as Error).message).not.toMatch(/model request failed/);
    }
  });

  it('names an HTTP status on a transport failure that carries one', async () => {
    const model: ModelClient = { async complete() { const e = new Error('x') as Error & { cause?: unknown }; e.cause = { status: 529 }; throw e; } };
    await expect(new ExtractionCanaryService(model).run()).rejects.toThrow(/HTTP 529/);
  });

  it('the error names the starvation shape (stop reason + tokens) for the health surface', async () => {
    const { model } = fakeModel({ text: '', stopReason: 'max_tokens', usage: { inputTokens: 10_500, outputTokens: 20_000, thinkingTokens: 20_000 } });
    try {
      await new ExtractionCanaryService(model).run();
      expect.unreachable('canary should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ExtractionCanaryError);
      expect((err as ExtractionCanaryError).message).toMatch(/max_tokens/);
    }
  });
});
