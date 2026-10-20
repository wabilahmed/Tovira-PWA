import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { RecordingTimer, mmss } from './RecordingTimer.js';

/** [P36-5 · owner, 20 Oct] The client page's voice recorder shows mm:ss while recording, plus the time left
 *  when there is a maximum length (the recorder stops itself at 10 minutes). */
afterEach(() => vi.useRealTimers());

describe('[P36-5] the recording timer', () => {
  it('mm:ss formatting', () => {
    expect(mmss(0)).toBe('00:00');
    expect(mmss(65_000)).toBe('01:05');
    expect(mmss(600_000)).toBe('10:00');
  });

  it('counts up each second and shows the time left against the max length', () => {
    vi.useFakeTimers();
    const start = Date.now();
    render(<RecordingTimer startedAt={start - 65_000} maxMs={600_000} />);
    expect(screen.getByTestId('rec-elapsed')).toHaveTextContent('01:05');
    expect(screen.getByTestId('rec-remaining')).toHaveTextContent('08:55 left');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId('rec-elapsed')).toHaveTextContent('01:06');
    expect(screen.getByTestId('rec-remaining')).toHaveTextContent('08:54 left');
  });

  it('no max length → no "left"', () => {
    render(<RecordingTimer startedAt={Date.now()} />);
    expect(screen.getByTestId('rec-elapsed')).toHaveTextContent('00:00');
    expect(screen.queryByTestId('rec-remaining')).toBeNull();
  });
});
