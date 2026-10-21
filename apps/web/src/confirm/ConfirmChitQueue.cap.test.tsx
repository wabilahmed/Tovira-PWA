import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmChitQueue, type ConfirmQueueApi, type CaptureQueueApi, type KeptQueueApi } from './ConfirmChitQueue.js';
import type { OpenPromise } from '../promises/promisesClient.js';
import { OVERFLOW, isView } from '../shell/nav.js';

/**
 * [P34-3] Phone review, 20 Oct: 1 Today entry under 10 To Confirm cards — the to-do was buried under homework.
 * On Today the queue shows at most 3 cards, newest first, then "See all 10"; the full list is its own screen
 * ("To Confirm", under More) with the same cards and buttons. Counts follow every confirm / dismiss.
 */
const T0 = Date.parse('2026-10-10T08:00:00Z');
const HOUR = 3600_000;
const promises = (n: number): OpenPromise[] => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, clientId: 'c1', clientName: 'Sara Khan', text: `Promise ${i}`, owner: 'rep', dueDate: null, dueRaw: null,
  confidence: 'low', done: false, confirmed: false, createdAt: T0 + i * HOUR,
}));
function apis(nPromises: number) {
  let list = promises(nPromises);
  const api: ConfirmQueueApi = {
    listConfirmations: vi.fn(async () => list),
    confirm: vi.fn(async (id: string) => { list = list.filter((p) => p.id !== id); return true; }),
    reject: vi.fn(async (id: string) => { list = list.filter((p) => p.id !== id); return true; }),
  };
  const captures: CaptureQueueApi = { listCaptures: vi.fn().mockResolvedValue([]), confirmCapture: vi.fn(), rejectCapture: vi.fn() };
  const kept: KeptQueueApi = { listKept: vi.fn().mockResolvedValue([]), markKeptDone: vi.fn(), undoKept: vi.fn(), notYetKept: vi.fn() };
  return { api, captures, kept };
}
const cardTexts = () => screen.getAllByRole('group').map((g) => g.textContent ?? '');

describe('[P34-3] Today shows at most 3 To Confirm cards', () => {
  it('10 pending → the 3 newest, then "See all 10" (which opens the full list)', async () => {
    const { api, captures, kept } = apis(10);
    const onSeeAll = vi.fn();
    render(<ConfirmChitQueue api={api} captures={captures} kept={kept} limit={3} onSeeAll={onSeeAll} />);
    await screen.findByText('Promise 9');
    expect(screen.getAllByRole('group')).toHaveLength(3);
    expect(cardTexts().map((t) => /Promise (\d)/.exec(t)![1])).toEqual(['9', '8', '7']); // newest first
    await userEvent.click(screen.getByRole('button', { name: 'See all 10' }));
    expect(onSeeAll).toHaveBeenCalled();
  });

  it('confirming one on Today leaves "See all 9" and pulls the next newest up', async () => {
    const { api, captures, kept } = apis(10);
    render(<ConfirmChitQueue api={api} captures={captures} kept={kept} limit={3} onSeeAll={vi.fn()} />);
    await screen.findByText('Promise 9');
    await userEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]!);
    await waitFor(() => expect(screen.getByRole('button', { name: 'See all 9' })).toBeInTheDocument());
    expect(cardTexts().map((t) => /Promise (\d)/.exec(t)![1])).toEqual(['8', '7', '6']);
  });

  it('3 or fewer → no "See all" link', async () => {
    const { api, captures, kept } = apis(3);
    render(<ConfirmChitQueue api={api} captures={captures} kept={kept} limit={3} onSeeAll={vi.fn()} />);
    await screen.findByText('Promise 2');
    expect(screen.queryByRole('button', { name: /see all/i })).toBeNull();
  });
});

describe('[P34-3] the full To Confirm screen', () => {
  it('renders all 10; confirming one leaves 9 (heading count and cards)', async () => {
    const { api, captures, kept } = apis(10);
    render(<ConfirmChitQueue api={api} captures={captures} kept={kept} />);
    await screen.findByText('Promise 0');
    expect(screen.getAllByRole('group')).toHaveLength(10);
    expect(screen.getByRole('heading', { name: /to confirm · 10/i })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]!);
    await waitFor(() => expect(screen.getAllByRole('group')).toHaveLength(9));
    expect(screen.getByRole('heading', { name: /to confirm · 9/i })).toBeInTheDocument();
  });

  // [P39 · owner] the screen is now called "Needs your answer".
  it('is reachable from More as "Needs your answer" (?view=confirm)', () => {
    expect(OVERFLOW.find((i) => i.view === 'confirm')?.label).toBe('Needs your answer');
    expect(isView('confirm')).toBe(true);
  });

  it('opening the full list after confirming one on Today shows 9 (each screen reads the server)', async () => {
    const { api, captures, kept } = apis(10);
    const { unmount } = render(<ConfirmChitQueue api={api} captures={captures} kept={kept} limit={3} onSeeAll={vi.fn()} />);
    await screen.findByText('Promise 9');
    await userEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]!);
    await screen.findByRole('button', { name: 'See all 9' });
    unmount();
    render(<ConfirmChitQueue api={api} captures={captures} kept={kept} />);
    await screen.findByText('Promise 0');
    expect(screen.getAllByRole('group')).toHaveLength(9);
  });
});
