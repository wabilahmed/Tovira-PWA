import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

/** [P23-B4] EXTRACT_WINDOWED is OFF by default; N/W/O are configurable and validated. */
const base = { DATABASE_URL: 'x' };
describe('[P23-B4] windowed extraction config', () => {
  it('off by default, N=150 W=120 O=20', () => {
    expect(loadConfig(base).windowing).toEqual({ enabled: false, threshold: 150, size: 120, overlap: 20 });
  });
  it('EXTRACT_WINDOWED=1 / true turns it on; N, W, O override', () => {
    expect(loadConfig({ ...base, EXTRACT_WINDOWED: '1' }).windowing.enabled).toBe(true);
    expect(loadConfig({ ...base, EXTRACT_WINDOWED: 'true', EXTRACT_WINDOW_THRESHOLD: '200', EXTRACT_WINDOW_SIZE: '150', EXTRACT_WINDOW_OVERLAP: '30' }).windowing).toEqual({ enabled: true, threshold: 200, size: 150, overlap: 30 });
    expect(loadConfig({ ...base, EXTRACT_WINDOWED: '0' }).windowing.enabled).toBe(false);
  });
  it('refuses an overlap that is not smaller than the window, and a non-number', () => {
    expect(() => loadConfig({ ...base, EXTRACT_WINDOW_SIZE: '20', EXTRACT_WINDOW_OVERLAP: '20' })).toThrow(/EXTRACT_WINDOW_OVERLAP/);
    expect(() => loadConfig({ ...base, EXTRACT_WINDOW_SIZE: 'big' })).toThrow(/EXTRACT_WINDOW_SIZE/);
    expect(() => loadConfig({ ...base, EXTRACT_WINDOWED: 'maybe' })).toThrow(/EXTRACT_WINDOWED/);
  });
});
