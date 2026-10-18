import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadConfig } from './config.js';
import { createModelClient, createExtractionModelRouter } from './container.js';

afterEach(() => vi.unstubAllGlobals());

/** [P23-A2] The effort/thinking settings reach the real request for every path that builds a client:
 *  createModelClient (aux classes, extraction canary/erasure) and the per-account extraction router. */
function bodies(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
    out.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
  }));
  return out;
}
const env = { DATABASE_URL: 'x', MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'http://t', MODEL_EXTRACT: 'claude-sonnet-5-5', MODEL_AUX: 'claude-haiku-5-5' };
const msg = { messages: [{ role: 'user' as const, content: 'x' }] };

describe('[P23-A2] effort wiring', () => {
  it('extraction class → Sonnet 5.5 at EFFORT_EXTRACT, adaptive thinking', async () => {
    const b = bodies();
    await createModelClient(loadConfig({ ...env, EFFORT_EXTRACT: 'medium' }), 'extraction').complete(msg);
    expect(b[0]).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'medium' } });
    expect(b[0]).not.toHaveProperty('thinking');
  });
  it('aux classes → Haiku 5.5 at EFFORT_AUX with thinking per AUX_THINKING', async () => {
    const b = bodies();
    await createModelClient(loadConfig(env), 'recall').complete(msg);
    expect(b[0]).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' }, thinking: { type: 'disabled' } });
  });
  it('a Haiku 5.5 EXTRACTION run (the side run) uses the extraction effort and keeps thinking', async () => {
    const b = bodies();
    await createModelClient(loadConfig({ ...env, MODEL_EXTRACT: 'claude-haiku-5-5' }), 'extraction').complete(msg);
    expect(b[0]).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' } });
    expect(b[0]).not.toHaveProperty('thinking');
  });
  it('the per-account router (paid AND trial) uses the configured extraction model + effort — no hardcoded Sonnet 5', async () => {
    const b = bodies();
    const cfg = loadConfig(env);
    for (const status of ['active', 'trialing']) {
      const route = await createExtractionModelRouter(cfg, async () => status)!.resolve('u');
      expect(route.modelId).toBe('claude-sonnet-5-5');
      await route.model.complete(msg);
    }
    expect(b.map((x) => [x.model, (x.output_config as { effort?: string } | undefined)?.effort])).toEqual([['claude-sonnet-5-5', 'low'], ['claude-sonnet-5-5', 'low']]);
  });
  it('NEGATIVE: today\'s defaults send no effort and no thinking (certified baseline untouched)', async () => {
    const b = bodies();
    const cfg = loadConfig({ DATABASE_URL: 'x', MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'http://t' });
    await createModelClient(cfg, 'extraction').complete(msg);
    await createModelClient(cfg, 'recall').complete(msg);
    await (await createExtractionModelRouter(cfg, async () => 'trialing')!.resolve('u')).model.complete(msg);
    for (const x of b) { expect(x).not.toHaveProperty('output_config'); expect(x).not.toHaveProperty('thinking'); }
    expect(b.map((x) => x.model)).toEqual(['claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-5']);
  });
});
