import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps } from './test-deps.js';
import { InMemoryJobRunStore } from '../adapters/scheduler/in-memory-scheduled-jobs.js';
import { ModelMetricsRegistry, NA_BELOW_MIN } from '../services/metrics/model-metrics.js';
import { PROMPT_VERSION } from '../services/extraction/prompt.js';

// SWEEP-NEVER-RUNS: /health must surface the scheduled brain's last run per job, so a
// scheduler that never fires is visible instead of looking like one with nothing to do.
describe('[SWEEP-NEVER-RUNS] /health surfaces scheduled-job liveness', () => {
  let server: Server;
  let base: string;
  const jobRuns = new InMemoryJobRunStore();

  const modelMetrics = new ModelMetricsRegistry();

  beforeAll(async () => {
    await jobRuns.record('notes-sweep', { at: Date.now() - 20_000, ok: true, error: null });
    await jobRuns.record('priorities-nightly', { at: Date.now() - 5_000, ok: false, error: 'boom' });
    // extraction cacheable (3/4 hit → 75%); recall never cacheable → n/a
    for (const hit of [false, true, true, true]) modelMetrics.record('extraction', 'claude-sonnet-5', { cacheable: true, hit });
    modelMetrics.record('recall', 'claude-haiku-4-5', { cacheable: false, hit: false });
    const deps = buildInMemoryDeps({ jobRuns, modelMetrics, adapterModes: { model: 'live', embedder: 'live' } });
    server = createApiServer(deps);
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('lists each job with ok + age (a dead scheduler shows as stale/absent, not healthy)', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      adapters?: Record<string, string>;
      jobs: Array<{ name: string; ok: boolean; ageSeconds: number; lastRunAt: string; error?: string }>;
    };
    expect(body.status).toBe('ok');
    expect(body.adapters).toMatchObject({ embedder: 'live' });

    const sweep = body.jobs.find((j) => j.name === 'notes-sweep');
    expect(sweep, 'notes-sweep present in /health').toBeTruthy();
    expect(sweep!.ok).toBe(true);
    expect(sweep!.ageSeconds).toBeGreaterThanOrEqual(19); // ~20s ago
    expect(typeof sweep!.lastRunAt).toBe('string');

    const nightly = body.jobs.find((j) => j.name === 'priorities-nightly');
    expect(nightly!.ok).toBe(false);
    expect(nightly!.error).toBe('boom'); // a failing job is visible, with its reason
  });

  // "What is staging running" should never take an investigation (FAB-INVESTIGATE lesson):
  // /version reports the deployed prompt version + build sha, unauthenticated, no DB.
  it('GET /version reports the prompt version and build, prefix-stripped too', async () => {
    for (const path of ['/version', '/api/version']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(200);
      const body = (await res.json()) as { promptVersion: string; build: string; env: string };
      expect(body.promptVersion).toBe(PROMPT_VERSION);
      expect(typeof body.build).toBe('string'); // sha or 'unknown', never absent
      expect(typeof body.env).toBe('string');
    }
  });

  it('surfaces per-class cache hit rate over cacheable calls (n/a for uncacheable classes)', async () => {
    const res = await fetch(`${base}/health`);
    const body = (await res.json()) as { cache: Record<string, { hitRate: string; cacheableCalls: number }> };
    expect(body.cache.extraction!.hitRate).toBe('75%'); // 3 of 4 cacheable calls hit
    expect(body.cache.recall!.hitRate).toBe(NA_BELOW_MIN); // never requested caching → not 0%
  });
});
