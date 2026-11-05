import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProcessing } from './useProcessing.js';
import type { ProcessingApi, ProcessingItem, ProcessingStatus } from './processingClient.js';
import { readingToast, readyToast } from './processingClient.js';

// [P65-3 · owner] The status is polled from the server every few seconds while something is working, only while the
// app is visible, and polling stops when nothing is.
const working: ProcessingItem = { noteId: 'n1', clientId: 'c1', clientName: 'Anjali Mehra', kind: 'chat', state: 'working', stage: 'reading', startedAt: 0, settledAt: null };
const done: ProcessingItem = { ...working, state: 'done', found: { promises: 4, overduePromises: 1, dates: 2, requirements: 0, people: 0, needsAnswer: 0 } };
const S = (items: ProcessingItem[]): ProcessingStatus => ({ items, working: items.filter((i) => i.state === 'working').length });
afterEach(() => { vi.useRealTimers(); });
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

describe('[P65-3] polling', () => {
  it('polls while something is working, fires onSettled once when it is done, then stops', async () => {
    vi.useFakeTimers();
    const answers = [S([working]), S([working]), S([done])];
    const api: ProcessingApi = { status: vi.fn(async () => answers.shift() ?? S([done])), retry: vi.fn() };
    const onSettled = vi.fn();
    const { result } = renderHook(() => useProcessing(api, { onSettled, pollMs: 1000 }));
    await flush();
    expect(result.current.status.working).toBe(1);
    await act(async () => { vi.advanceTimersByTime(1000); }); await flush();
    await act(async () => { vi.advanceTimersByTime(1000); }); await flush();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled.mock.calls[0]![0]).toMatchObject({ noteId: 'n1', state: 'done' });
    const calls = (api.status as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(10_000); }); await flush();
    expect((api.status as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls); // NEGATIVE: stopped
  });
  it('NEGATIVE: nothing working: one read on open, no polling', async () => {
    vi.useFakeTimers();
    const api: ProcessingApi = { status: vi.fn(async () => S([])), retry: vi.fn() };
    renderHook(() => useProcessing(api, { pollMs: 1000 }));
    await flush();
    await act(async () => { vi.advanceTimersByTime(60_000); }); await flush();
    expect(api.status).toHaveBeenCalledTimes(1);
  });
  it('right after a send it keeps asking even before the server has it (a voice note still uploading)', async () => {
    vi.useFakeTimers();
    const answers = [S([]), S([]), S([working])];
    const api: ProcessingApi = { status: vi.fn(async () => answers.shift() ?? S([working])), retry: vi.fn() };
    const { result } = renderHook(() => useProcessing(api, { pollMs: 1000 }));
    await flush();
    act(() => { result.current.kick(); }); await flush();
    await act(async () => { vi.advanceTimersByTime(1000); }); await flush();
    expect(result.current.status.working).toBe(1);
  });
  it('NEGATIVE: a held item (allowance used up) is not polled: nothing changes until a top-up', async () => {
    vi.useFakeTimers();
    const api: ProcessingApi = { status: vi.fn(async () => S([{ ...working, state: 'held', hold: 'allowance' }])), retry: vi.fn() };
    renderHook(() => useProcessing(api, { pollMs: 1000 }));
    await flush();
    await act(async () => { vi.advanceTimersByTime(10_000); }); await flush();
    expect(api.status).toHaveBeenCalledTimes(1);
  });
});

describe('[P65-3] the toasts', () => {
  it('on submit: "Reading your chat with Anjali Mehra…" (or your voice note, your note)', () => {
    expect(readingToast('chat', 'Anjali Mehra')).toBe('Reading your chat with Anjali Mehra…');
    expect(readingToast('voice', 'Anjali Mehra')).toBe('Reading your voice note about Anjali Mehra…');
    expect(readingToast('typed', 'Anjali Mehra')).toBe('Reading your note about Anjali Mehra…');
  });
  it('when ready: "Anjali Mehra is ready: 4 promises, 2 dates."; a failure says so', () => {
    expect(readyToast(done)).toBe('Anjali Mehra is ready: 4 promises, 2 dates.');
    expect(readyToast({ ...done, found: { promises: 1, overduePromises: 0, dates: 0, requirements: 0, people: 0, needsAnswer: 0 } })).toBe('Anjali Mehra is ready: 1 promise.');
    expect(readyToast({ ...working, state: 'failed', failure: { reason: 'ours', canRetry: true } })).toBe("Tovira couldn't read your chat for Anjali Mehra.");
  });
});
