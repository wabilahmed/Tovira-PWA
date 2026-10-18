import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicModelClient } from './anthropic.js';
import { modelCapabilities } from './capabilities.js';

afterEach(() => vi.unstubAllGlobals());

/** [P23-A2] Request shape per model. 5.5 models: effort ALWAYS explicit (never the API default), never a
 *  sampling parameter (400), never forced tool use / prefill (we use neither). Sonnet 5 / Haiku 4.5 send
 *  exactly what they sent before — the certified baseline is not changed by this commit. */
function capture(): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
  }));
  return bodies;
}
const req = { messages: [{ role: 'user' as const, content: 'x' }], temperature: 0 };

describe('[P23-A2] Sonnet 5.5', () => {
  it('sends output_config.effort, no temperature/top_p/top_k, no thinking field (adaptive)', async () => {
    const b = capture();
    const res = await new AnthropicModelClient({ apiKey: 'k', baseUrl: 'http://t', model: 'claude-sonnet-5-5', effort: 'low' }).complete(req);
    expect(b[0]!.output_config).toEqual({ effort: 'low' });
    expect(b[0]).not.toHaveProperty('temperature');
    expect(b[0]).not.toHaveProperty('top_p');
    expect(b[0]).not.toHaveProperty('top_k');
    expect(b[0]).not.toHaveProperty('thinking');
    expect(b[0]).not.toHaveProperty('tool_choice');
    expect(res.text).toBe('ok'); // the text block is selected by type, not position (a thinking block comes first)
  });
  it('refuses to send thinking "disabled" (a 400 on Sonnet 5.5) — it is dropped, adaptive stays', async () => {
    const b = capture();
    await new AnthropicModelClient({ apiKey: 'k', baseUrl: 'http://t', model: 'claude-sonnet-5-5', effort: 'low', thinking: 'disabled' }).complete(req);
    expect(b[0]).not.toHaveProperty('thinking');
  });
  it('throws at construction if a 5.5 model is given no effort (never the API default)', () => {
    expect(() => new AnthropicModelClient({ apiKey: 'k', baseUrl: 'http://t', model: 'claude-sonnet-5-5' })).toThrow(/effort/);
    expect(() => new AnthropicModelClient({ apiKey: 'k', baseUrl: 'http://t', model: 'claude-haiku-5-5' })).toThrow(/effort/);
  });
});

describe('[P23-A2] Haiku 5.5', () => {
  it('sends effort + thinking disabled when asked, no sampling params', async () => {
    const b = capture();
    await new AnthropicModelClient({ apiKey: 'k', baseUrl: 'http://t', model: 'claude-haiku-5-5', effort: 'low', thinking: 'disabled' }).complete(req);
    expect(b[0]!.output_config).toEqual({ effort: 'low' });
    expect(b[0]!.thinking).toEqual({ type: 'disabled' });
    expect(b[0]).not.toHaveProperty('temperature');
  });
  it('thinking "disabled" is not sent above high effort (a 400 at xhigh/max)', async () => {
    const b = capture();
    await new AnthropicModelClient({ apiKey: 'k', baseUrl: 'http://t', model: 'claude-haiku-5-5', effort: 'max', thinking: 'disabled' }).complete(req);
    expect(b[0]).not.toHaveProperty('thinking');
  });
});

describe('[P23-A2] unchanged for today\'s models', () => {
  it('Sonnet 5: no effort, no thinking, and no temperature (it already 400s on one)', async () => {
    const b = capture();
    await new AnthropicModelClient({ apiKey: 'k', baseUrl: 'http://t', model: 'claude-sonnet-5', effort: 'low' }).complete(req);
    expect(b[0]).not.toHaveProperty('output_config');
    expect(b[0]).not.toHaveProperty('thinking');
    expect(b[0]).not.toHaveProperty('temperature');
  });
  it('Haiku 4.5: temperature still forwarded, no effort (it has none)', async () => {
    const b = capture();
    await new AnthropicModelClient({ apiKey: 'k', baseUrl: 'http://t', model: 'claude-haiku-4-5-20251001', effort: 'low' }).complete(req);
    expect(b[0]!.temperature).toBe(0);
    expect(b[0]).not.toHaveProperty('output_config');
  });
  it('capabilities table', () => {
    expect(modelCapabilities('claude-sonnet-5-5')).toMatchObject({ explicitEffort: true, sampling: false, canDisableThinking: false });
    expect(modelCapabilities('claude-haiku-5-5')).toMatchObject({ explicitEffort: true, sampling: false, canDisableThinking: true });
    expect(modelCapabilities('claude-sonnet-5')).toMatchObject({ explicitEffort: false, sampling: false });
    expect(modelCapabilities('claude-haiku-4-5-20251001')).toMatchObject({ explicitEffort: false, sampling: true });
  });
});
