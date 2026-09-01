import { describe, it, expect } from 'vitest';
import { ModelMetricsRegistry, NA_BELOW_MIN } from './model-metrics.js';

describe('[CACHE-1] ModelMetricsRegistry', () => {
  it('reports hit rate over CACHEABLE calls, not total calls', () => {
    const t = 1000;
    const r = new ModelMetricsRegistry({ now: () => t });
    // extraction: 4 cacheable calls, 3 hit → 75% (NOT diluted by anything else)
    r.record('extraction', 'claude-sonnet-5', { cacheable: true, hit: false });
    r.record('extraction', 'claude-sonnet-5', { cacheable: true, hit: true });
    r.record('extraction', 'claude-sonnet-5', { cacheable: true, hit: true });
    r.record('extraction', 'claude-sonnet-5', { cacheable: true, hit: true });
    const snap = r.snapshot();
    expect(snap.extraction!.hitRate).toBe('75%');
    expect(snap.extraction!.cacheableCalls).toBe(4);
    expect(snap.extraction!.hits).toBe(3);
  });

  it('reports n/a (not 0%) for a class that never requests caching', () => {
    const r = new ModelMetricsRegistry();
    r.record('recall', 'claude-haiku-4-5', { cacheable: false, hit: false });
    r.record('recall', 'claude-haiku-4-5', { cacheable: false, hit: false });
    const snap = r.snapshot();
    expect(snap.recall!.hitRate).toBe(NA_BELOW_MIN);
    expect(snap.recall!.calls).toBe(2);
    expect(snap.recall!.cacheableCalls).toBe(0);
  });

  it('rolls off events older than the window', () => {
    let t = 0;
    const r = new ModelMetricsRegistry({ windowMs: 1000, now: () => t });
    r.record('extraction', 'm', { cacheable: true, hit: false }); // t=0
    t = 2000; // 2s later — the first event is outside the 1s window
    r.record('extraction', 'm', { cacheable: true, hit: true });
    const snap = r.snapshot();
    expect(snap.extraction!.calls).toBe(1);
    expect(snap.extraction!.hitRate).toBe('100%');
  });
});
