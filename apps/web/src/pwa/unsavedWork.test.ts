import { describe, it, expect } from 'vitest';
import { registerUnsavedSource, hasUnsavedWork } from './unsavedWork.js';

describe('[P14-4b] unsavedWork registry', () => {
  it('reports false when no source has unsaved work', async () => {
    const off = registerUnsavedSource(() => false);
    expect(await hasUnsavedWork()).toBe(false);
    off();
  });

  it('reports true when ANY source does (outbox OR a live recording)', async () => {
    const offA = registerUnsavedSource(() => false);
    const offB = registerUnsavedSource(async () => true);
    expect(await hasUnsavedWork()).toBe(true);
    offA(); offB();
    expect(await hasUnsavedWork()).toBe(false); // unregistered → back to clean
  });

  it('fails SAFE — a throwing source counts as unsaved (never risk a silent reload)', async () => {
    const off = registerUnsavedSource(() => { throw new Error('store unavailable'); });
    expect(await hasUnsavedWork()).toBe(true);
    off();
  });
});
