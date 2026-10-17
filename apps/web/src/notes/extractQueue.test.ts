import { describe, it, expect } from 'vitest';
import { notesToExtract } from './extractQueue.js';

const n = (id: string, over: Partial<{ status: string; blockedReason: 'subscribe' | 'payment' | 'allowance' | null }> = {}) =>
  ({ id, status: 'pending_extraction', blockedReason: null, ...over });

describe('[P16-3c] notesToExtract', () => {
  it('includes a plain pending note', () => {
    expect(notesToExtract([n('a')], new Set()).map((x) => x.id)).toEqual(['a']);
  });
  it('SKIPS a note with a blockedReason (no pointless request; server would only 402 it)', () => {
    expect(notesToExtract([n('a', { blockedReason: 'subscribe' }), n('b')], new Set()).map((x) => x.id)).toEqual(['b']);
  });
  it('SKIPS a note at the ceiling', () => {
    expect(notesToExtract([n('a'), n('b')], new Set(['a'])).map((x) => x.id)).toEqual(['b']);
  });
  it('ignores notes not pending extraction', () => {
    expect(notesToExtract([n('a', { status: 'extracted' }), n('b', { status: 'pending_transcription' })], new Set())).toEqual([]);
  });
});
