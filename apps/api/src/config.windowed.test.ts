import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

/** [P23-B4] EXTRACT_WINDOWED is OFF by default; N/W/O are configurable and validated. */
const base = { DATABASE_URL: 'x' };
describe('[P23-B4] windowed extraction config', () => {
  // [P68-3 · owner, 19 Nov] "Run pieces in parallel": the config gains `concurrency` (EXTRACT_WINDOW_CONCURRENCY,
  // default 4). The exact-shape pins below move with this note; N, W, O and their defaults are unchanged.
  it('off by default, N=150 W=120 O=20, 4 pieces at once', () => {
    expect(loadConfig(base).windowing).toEqual({ enabled: false, threshold: 150, size: 120, overlap: 20, concurrency: 4 });
  });
  it('EXTRACT_WINDOWED=1 / true turns it on; N, W, O and the concurrency override', () => {
    expect(loadConfig({ ...base, EXTRACT_WINDOWED: '1' }).windowing.enabled).toBe(true);
    expect(loadConfig({ ...base, EXTRACT_WINDOWED: 'true', EXTRACT_WINDOW_THRESHOLD: '200', EXTRACT_WINDOW_SIZE: '150', EXTRACT_WINDOW_OVERLAP: '30', EXTRACT_WINDOW_CONCURRENCY: '2' }).windowing).toEqual({ enabled: true, threshold: 200, size: 150, overlap: 30, concurrency: 2 });
    expect(loadConfig({ ...base, EXTRACT_WINDOWED: '0' }).windowing.enabled).toBe(false);
  });
  it('[P68-3] NEGATIVE: a concurrency that is not a positive number stops the boot, naming it', () => {
    expect(() => loadConfig({ ...base, EXTRACT_WINDOW_CONCURRENCY: '0' })).toThrow(/EXTRACT_WINDOW_CONCURRENCY/);
    expect(() => loadConfig({ ...base, EXTRACT_WINDOW_CONCURRENCY: 'many' })).toThrow(/EXTRACT_WINDOW_CONCURRENCY/);
  });
  it('refuses an overlap that is not smaller than the window, and a non-number', () => {
    expect(() => loadConfig({ ...base, EXTRACT_WINDOW_SIZE: '20', EXTRACT_WINDOW_OVERLAP: '20' })).toThrow(/EXTRACT_WINDOW_OVERLAP/);
    expect(() => loadConfig({ ...base, EXTRACT_WINDOW_SIZE: 'big' })).toThrow(/EXTRACT_WINDOW_SIZE/);
    expect(() => loadConfig({ ...base, EXTRACT_WINDOWED: 'maybe' })).toThrow(/EXTRACT_WINDOWED/);
  });
});
