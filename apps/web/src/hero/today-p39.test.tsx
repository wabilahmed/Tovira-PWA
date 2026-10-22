import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeroInsights, dueBadge, todaySubtitle, type HeroApi } from './HeroInsights.js';
import { ConfirmChitQueue, type ConfirmQueueApi } from '../confirm/ConfirmChitQueue.js';
import type { TodayAction } from './heroClient.js';
import type { OpenPromise } from '../promises/promisesClient.js';

/**
 * [P39-5] Today on the design system: PageHeader "Today" with the date as its subtitle ("Wednesday 21 Oct"),
 * Refresh as an icon button, no "1 entry" count and no "01" numbering; three sections, each with its one-line
 * explanation; a promise card carries a status badge — "Overdue" (danger), "Due today" or "Due Thu"; "Needs your
 * answer" shows at most 3, then "See all N".
 */
const WED_21_OCT = new Date(2026, 9, 21, 9, 0);
const api = (actions: TodayAction[], body?: unknown): HeroApi => ({
  status: vi.fn().mockResolvedValue({ unlocked: true, counts: { clients: 5, notes: 20 }, needed: { clients: 0, notes: 0 }, message: '' }),
  patterns: vi.fn().mockResolvedValue([]),
  risk: vi.fn().mockResolvedValue([]),
  today: vi.fn().mockResolvedValue(body ?? { actions, refreshesRemaining: 2 }),
  refreshToday: vi.fn().mockResolvedValue(null),
});
const promise = (o: Partial<TodayAction>): TodayAction => ({ kind: 'promise', priority: 3, text: 'x', clientId: 'c1', clientName: 'Sara Khan', title: 'Send the floor plans', owner: 'rep', ...o });

describe('[P39-5] the Today header', () => {
  it('"Today" with the date as subtitle; Refresh is an icon button; no count, no numbering', async () => {
    const { container } = render(<HeroInsights now={() => WED_21_OCT} api={api([promise({ dueDate: '2026-10-21', subline: 'due 21 Oct 2026' })])} />);
    const header = await screen.findByTestId('page-header');
    expect(within(header).getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(header).toHaveTextContent('Wednesday 21 Oct');
    const refresh = within(header).getByRole('button', { name: 'Refresh' });
    expect(refresh).toHaveClass('ui-iconbtn');
    expect(container.textContent).not.toMatch(/\bentr(y|ies)\b/i);
    expect(container.textContent).not.toMatch(/\b01\b/);
  });

  it('todaySubtitle reads weekday, day, short month', () => {
    expect(todaySubtitle(WED_21_OCT)).toBe('Wednesday 21 Oct');
  });
});

describe('[P39-5] three sections, each explained', () => {
  it('To do today · Deals at risk · Needs your answer, with their one-liners', async () => {
    const confirmApi: ConfirmQueueApi = { listConfirmations: vi.fn().mockResolvedValue([{ id: 'p1', text: 'Send ID photos', clientId: 'c1', clientName: 'Sara', owner: 'client', createdAt: 1 } as OpenPromise]), confirm: vi.fn(), reject: vi.fn() };
    render(<HeroInsights now={() => WED_21_OCT} api={api([])} needsAnswer={<ConfirmChitQueue api={confirmApi} limit={3} onSeeAll={() => {}} />} />);
    expect(await screen.findByRole('heading', { name: 'To do today' })).toBeInTheDocument();
    expect(screen.getByText("What's due and who's waiting on you.")).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Deals at risk' })).toBeInTheDocument();
    expect(screen.getByText('Clients who may be slipping, and why.')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Needs your answer' })).toBeInTheDocument();
    expect(screen.queryByText(/patterns &(amp;)? risk/i)).toBeNull();
  });

  it('"Needs your answer" shows at most 3, then "See all N"', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, text: `Thing ${i}`, clientId: 'c1', clientName: 'Sara', owner: 'client', createdAt: i } as OpenPromise));
    const onSeeAll = vi.fn();
    render(<ConfirmChitQueue api={{ listConfirmations: vi.fn().mockResolvedValue(many), confirm: vi.fn(), reject: vi.fn() }} limit={3} onSeeAll={onSeeAll} />);
    const section = await screen.findByTestId('needs-answer');
    expect(await within(section).findByText('Thing 4')).toBeInTheDocument();
    expect(within(section).queryByText('Thing 1')).toBeNull();
    await userEvent.click(within(section).getByRole('button', { name: 'See all 5' }));
    expect(onSeeAll).toHaveBeenCalledOnce();
  });
});

describe('[P39-5] the status badge', () => {
  it('Overdue (danger) / Due today / Due Thu', async () => {
    render(<HeroInsights now={() => WED_21_OCT} api={api([
      promise({ title: 'Late one', dueDate: '2026-10-19' }),
      promise({ title: 'Today one', dueDate: '2026-10-21' }),
      promise({ title: 'Thursday one', dueDate: '2026-10-22' }),
    ])} />);
    const badges = await screen.findAllByTestId('due-badge');
    expect(badges.map((b) => b.textContent)).toEqual(['Overdue', 'Due today', 'Due Thu']);
    expect(badges[0]).toHaveClass('ui-badge--danger');
    expect(badges[1]).not.toHaveClass('ui-badge--danger');
  });

  it('dueBadge: none without a date; never for a non-promise', async () => {
    expect(dueBadge(undefined, '2026-10-21')).toBeNull();
    render(<HeroInsights now={() => WED_21_OCT} api={api([{ kind: 'cold', priority: 1, text: 'Reach out', clientId: 'c1', clientName: 'Omar', title: 'Reach out — going cold', subline: 'silent 40 days' }])} />);
    await screen.findByText(/Reach out/);
    expect(screen.queryByTestId('due-badge')).toBeNull();
  });
});

describe('[P39-5] negative: a malformed /today body never crashes Today', () => {
  it('an unexpected body → the empty state', async () => {
    render(<HeroInsights now={() => WED_21_OCT} api={api([], { nope: true })} />);
    expect(await screen.findByText(/nothing for today yet/i)).toBeInTheDocument();
  });
});
