import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeroInsights, type HeroApi } from './HeroInsights.js';
import type { TodayAction } from './heroClient.js';

/**
 * [P47-2] A going-quiet alert counts toward "Clients Tovira helped you win back" only once it REACHED the rep. Today
 * reports the going-quiet cards it actually showed (the server re-checks each client before recording it).
 */
const cold = (id: string): TodayAction => ({ kind: 'cold', priority: 1, text: 'x', clientId: id, clientName: `Client ${id}`, title: 'Reach out. Going cold for 40 days', subline: 'silent 40 days', receipt: { quote: null, source: 'contact', at: '2026-09-05' } } as TodayAction);
const promise: TodayAction = { kind: 'promise', priority: 4, text: 'x', clientId: 'p1', clientName: 'Omar', title: 'Send the plans', owner: 'rep', dueDate: '2026-10-01', subline: 'overdue', receipt: { quote: 'I will send them', source: 'message', at: '2026-09-30T10:00' } } as TodayAction;
const api = (actions: TodayAction[], over: Partial<HeroApi> = {}): HeroApi => ({
  status: vi.fn().mockResolvedValue({ unlocked: true, counts: { clients: 9, notes: 30 }, needed: { clients: 0, notes: 0 }, message: '' }),
  patterns: vi.fn().mockResolvedValue([]),
  risk: vi.fn().mockResolvedValue([]),
  today: vi.fn().mockResolvedValue({ actions, refreshesRemaining: 2 }),
  refreshToday: vi.fn().mockResolvedValue({ actions, refreshesRemaining: 1 }),
  coldShown: vi.fn().mockResolvedValue(undefined),
  ...over,
});

describe('[P47-2] Today reports the going-quiet cards it showed', () => {
  it('the going-quiet cards on screen are reported, once', async () => {
    const a = api([promise, cold('c1'), cold('c2')]);
    render(<HeroInsights api={a} />);
    await waitFor(() => expect(a.coldShown).toHaveBeenCalledWith(['c1', 'c2']));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(a.coldShown).toHaveBeenCalledTimes(1); // the same cards again are not reported again
  });

  it('NEGATIVE: no going-quiet card on screen → nothing reported', async () => {
    const a = api([promise]);
    render(<HeroInsights api={a} />);
    await screen.findByText('Send the plans');
    await new Promise((r) => setTimeout(r, 20));
    expect(a.coldShown).not.toHaveBeenCalled();
  });
});
