import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { AiGate, AiGateRefused } from './ai-gate.js';
import { InMemoryAiAllowanceRepository } from '../../adapters/spend/in-memory-ai-allowance-repository.js';
import { anthropicEstimateAed } from '../../adapters/spend/gated-ai-clients.js';
import { createModelClient, createEmbedder, createTranscriber } from '../../container.js';
import { GatedModelClient, GatedEmbedder, GatedTranscriber } from '../../adapters/spend/gated-ai-clients.js';
import { anthropicCostUsd, transcriptionCostUsd, usdToAed, estimateAudioSeconds } from './ai-prices.js';
import { loadConfig } from '../../config.js';

/**
 * [USAGE-ALLOWANCE · Task 3] The STANDING guards. Each is mutation-proven. A single rep can never run up
 * an AI bill beyond its allowance, no bug can either, and no paid call can bypass the gate.
 */

const apiSrc = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'); // apps/api/src
const WINDOW = { status: 'active', trialEndsAt: null, renewsAt: null, periodStart: Date.parse('2026-10-01T00:00:00Z') };

function gateWith(allowance: InMemoryAiAllowanceRepository, opts: { allowanceAed?: number; paused?: boolean; alert?: number; onAlert?: (ym: string, t: number) => void } = {}) {
  return new AiGate({
    allowance,
    allowanceAed: opts.allowanceAed ?? 40,
    alertThresholdAed: opts.alert ?? 300,
    billingWindowFor: async () => WINDOW,
    isPaused: () => opts.paused ?? false,
    onAlert: opts.onAlert,
    now: () => Date.parse('2026-10-10T00:00:00Z'),
  });
}

// ─── GUARD 1: concurrency — exactly the affordable number of parallel calls proceed ─────────────────
describe('[GUARD 1] parallel reservations never both fit the same headroom', () => {
  it('20 parallel reserves against headroom for 5 admit EXACTLY 5', async () => {
    const repo = new InMemoryAiAllowanceRepository();
    await repo.ensureMonth('u', 'm:2026-10', WINDOW.periodStart, 40);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => repo.reserve('u', 'm:2026-10', 8, Date.now() + 60_000)), // 40/8 = 5
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });
});

// ─── GUARD 2: the allowance is checked BEFORE the provider call ──────────────────────────────────────
describe('[GUARD 2] an over-allowance call is refused before any provider request', () => {
  it('a rep at AED 39.50 attempting a AED 1.00 call is refused and the provider is never called', async () => {
    const repo = new InMemoryAiAllowanceRepository();
    const gate = gateWith(repo, { allowanceAed: 40 });
    await gate.run({ userId: 'u', estimateAed: 39.5, exec: async () => ({ aed: 39.5 }), actualAedFrom: (r) => r.aed }); // now ~39.5 spent
    let providerCalled = false;
    await expect(
      gate.run({ userId: 'u', estimateAed: 1, exec: async () => { providerCalled = true; return { aed: 1 }; }, actualAedFrom: (r) => r.aed }),
    ).rejects.toMatchObject({ reason: 'account_limit' });
    expect(providerCalled).toBe(false);
  });
});

// ─── GUARD 3: no ungated provider calls — endpoints localized + factories return gated wrappers ──────
describe('[GUARD 3] every paid call goes through the gate', () => {
  const PROVIDER_MARKERS = ['/v1/messages', '/openai/v1/audio/transcriptions', '@aws-sdk/client-bedrock-runtime', 'BedrockRuntimeClient', 'InvokeModelCommand'];
  const ALLOWED = new Set([
    resolve(apiSrc, 'adapters/model/anthropic.ts'),
    resolve(apiSrc, 'adapters/transcription/groq.ts'),
    resolve(apiSrc, 'adapters/embedding/bedrock.ts'),
  ]);
  const allSrc = (): string[] => {
    const out: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p); } };
    walk(apiSrc);
    return out;
  };

  it('a raw provider endpoint / SDK appears ONLY in the three transport adapters', () => {
    for (const file of allSrc()) {
      if (ALLOWED.has(file)) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of PROVIDER_MARKERS) expect(src.includes(m), `${file} reaches a provider directly ("${m}") — route it through the gate`).toBe(false);
    }
  });

  // The wall that fails on the pre-gating code and passes after: the factories return GATED wrappers.
  it('the model / embedder / transcriber factories return gated wrappers', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://t:t@localhost:5432/t' });
    expect(createModelClient(config)).toBeInstanceOf(GatedModelClient);
    expect(createEmbedder(config)).toBeInstanceOf(GatedEmbedder);
    expect(createTranscriber(config)).toBeInstanceOf(GatedTranscriber);
  });
});

// ─── GUARD 4: the global alert fires once and refuses nothing (D13, ruling) ─────────────────────────
describe('[GUARD 4] crossing the alert threshold emails once and blocks no calls', () => {
  it('fires exactly one alert and every call still succeeds', async () => {
    const repo = new InMemoryAiAllowanceRepository();
    const alerts: number[] = [];
    const gate = gateWith(repo, { allowanceAed: 1000, alert: 5, onAlert: (_ym, t) => alerts.push(t) });
    const run = (aed: number) => gate.run({ userId: 'u', estimateAed: aed, exec: async () => ({ aed }), actualAedFrom: (r) => r.aed });
    const r1 = await run(3); // total 3
    const r2 = await run(4); // total 7 crosses 5
    const r3 = await run(4); // total 11
    expect(alerts).toHaveLength(1); // exactly once
    expect([r1, r2, r3].every((r) => r.aed > 0)).toBe(true); // nothing refused
  });
});

// ─── GUARD 5: the kill switch refuses with zero provider requests ───────────────────────────────────
describe('[GUARD 5] AI_PAUSED refuses every (non-exempt) call with no provider request', () => {
  it('refuses and never calls the provider when paused', async () => {
    const gate = gateWith(new InMemoryAiAllowanceRepository(), { paused: true });
    let providerCalled = false;
    await expect(
      gate.run({ userId: 'u', estimateAed: 0.01, exec: async () => { providerCalled = true; return { aed: 0 }; }, actualAedFrom: (r) => r.aed }),
    ).rejects.toBeInstanceOf(AiGateRefused);
    expect(providerCalled).toBe(false);
  });
});

// ─── GUARD 6: the estimate is NEVER below the actual ────────────────────────────────────────────────
describe('[GUARD 6] worst-case estimate >= actual cost over every fixture', () => {
  it('Anthropic: estimate >= actual for cold, warm, and token-dense inputs; reports the max ratio', () => {
    const model = 'claude-sonnet-5';
    // Each fixture: a request (system+message) and a plausible ACTUAL usage for it.
    const prose = 'x'.repeat(4000); // ~chars; real tokens are fewer
    const dense = '{}[]();'.repeat(600); // symbol-dense: ~2-3 chars/token
    const fixtures = [
      { req: { system: prose, messages: [{ role: 'user' as const, content: prose }], maxTokens: 1000 }, usage: { inputTokens: 2000, outputTokens: 1000, cacheCreationInputTokens: 2000, cacheReadInputTokens: 0 } }, // cold
      { req: { system: prose, messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 1000 }, usage: { inputTokens: 50, outputTokens: 1000, cacheCreationInputTokens: 0, cacheReadInputTokens: 1100 } }, // warm
      { req: { system: dense, messages: [{ role: 'user' as const, content: dense }], maxTokens: 800 }, usage: { inputTokens: 1600, outputTokens: 800, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } }, // dense
    ];
    let maxRatio = 0;
    for (const f of fixtures) {
      const estimate = anthropicEstimateAed(model, f.req);
      const actual = usdToAed(anthropicCostUsd(model, f.usage));
      expect(estimate, `estimate ${estimate} < actual ${actual}`).toBeGreaterThanOrEqual(actual);
      maxRatio = Math.max(maxRatio, estimate / actual);
    }
    console.log(`[GUARD 6] Anthropic largest estimate/actual ratio = ${maxRatio.toFixed(2)}x`);
  });

  it('transcription: estimate (from bytes) >= actual (from exact duration)', () => {
    const model = 'whisper-large-v3';
    const bytes = 120 * (96_000 / 8); // 120 s of 96 kbps audio
    const estimate = usdToAed(transcriptionCostUsd(model, estimateAudioSeconds(bytes)));
    const actual = usdToAed(transcriptionCostUsd(model, 120)); // exact duration
    expect(estimate).toBeGreaterThanOrEqual(actual);
  });
});
