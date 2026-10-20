import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeroInsights, type HeroApi } from './HeroInsights.js';
import { ConfirmChitQueue, type ConfirmQueueApi, type CaptureQueueApi, type KeptQueueApi } from '../confirm/ConfirmChitQueue.js';
import type { TodayAction } from './heroClient.js';
import type { OpenPromise } from '../promises/promisesClient.js';

/**
 * [P34-7] Phone review, 20 Oct: no card showed the message it came from — and receipts are Tovira's core promise.
 * Every Today entry and To Confirm card has one source line under it — "Sara Khan, 7 May 2026: “…”", cut to
 * about 90 characters, dates through the shared formatter (never ISO), the stored text verbatim — and a tap
 * expands the full receipt (both messages for a kept-promise suggestion). A "Remember that…" note reads
 * "Your note, 19 Oct 2026". Everything arrives with the list (no per-card fetch).
 */
const ISO = /\d{4}-\d{2}-\d{2}T/;
const LONG = "Great, I'll send you the floor plans tomorrow, and the service-charge breakdown for the 4BR in Mirdif once the landlord replies to me";

const heroApi = (actions: TodayAction[]): HeroApi => ({
  status: vi.fn().mockResolvedValue({ unlocked: true, counts: { clients: 5, notes: 20 }, needed: { clients: 0, notes: 0 }, message: '' }),
  patterns: vi.fn().mockResolvedValue([]),
  risk: vi.fn().mockResolvedValue([]),
  today: vi.fn().mockResolvedValue({ actions, refreshesRemaining: 2 }),
  refreshToday: vi.fn().mockResolvedValue(null),
});
const action = (o: Partial<TodayAction>): TodayAction => ({ kind: 'promise', priority: 3, text: 'x', clientId: 'c1', clientName: 'Sara Khan', title: 'Send the floor plans', owner: 'rep', subline: 'due 21 Oct 2026', ...o });

describe('[P34-7] every Today entry shows its source line', () => {
  it('chat promise, own-note promise, cooling client, no-span promise — one source line each, no ISO dates', async () => {
    const { container } = render(<HeroInsights api={heroApi([
      action({ receipt: { quote: "Great, I'll send you the floor plans tomorrow", source: 'message', at: '2026-05-07T11:15' } }),
      action({ title: 'Call the developer', receipt: { quote: 'I will call the developer on Sunday', source: 'capture', at: '2026-10-19' } }),
      action({ kind: 'cold', clientName: 'Omar Ali', title: 'Reach out — going cold', subline: 'silent 45 days', receipt: { quote: null, source: 'contact', at: '2026-09-05' } }),
      action({ title: 'Old fact', receipt: { quote: null, source: 'none', at: null } }),
    ])} />);
    const items = within(await screen.findByTestId('today-list')).getAllByRole('listitem');
    const lines = items.map((li) => within(li).getByTestId('source-line').textContent);
    expect(lines).toEqual([
      'Sara Khan, 7 May 2026: “Great, I\'ll send you the floor plans tomorrow”',
      'Your note, 19 Oct 2026: “I will call the developer on Sunday”',
      'Omar Ali, last contact 5 Sep 2026',
      'No source quote was saved for this fact',
    ]);
    expect(container.textContent).not.toMatch(ISO);
  });

  it('a long quote is cut to about 90 characters; a tap expands the full receipt', async () => {
    render(<HeroInsights api={heroApi([action({ receipt: { quote: LONG, source: 'message', at: '2026-05-07T11:15' } })])} />);
    const line = await screen.findByTestId('source-line');
    const quoted = /“(.*)”/.exec(line.textContent ?? '')![1]!;
    expect(quoted.length).toBeLessThanOrEqual(91);
    expect(quoted.endsWith('…')).toBe(true);
    expect(screen.queryByText(LONG, { exact: false })).toBeNull();
    await userEvent.click(line);
    expect(line).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(`“${LONG}”`)).toBeInTheDocument(); // the full receipt, verbatim
  });
});

describe('[P34-7] every To Confirm card shows its source line', () => {
  it('promise, Ask capture ("Your note, 19 Oct 2026") and kept suggestion (tap → both messages); no ISO', async () => {
    const promise: OpenPromise = {
      id: 'p1', clientId: 'c1', clientName: 'Sara Khan', text: 'Send the floor plans', owner: 'rep', dueDate: null, dueRaw: null, confidence: 'low', done: false, confirmed: false, createdAt: 3,
      receipt: { quote: "Great, I'll send you the floor plans tomorrow", source: 'message', at: '2026-05-07T11:15', label: '' },
    };
    const api: ConfirmQueueApi = { listConfirmations: vi.fn().mockResolvedValue([promise]), confirm: vi.fn(), reject: vi.fn() };
    const captures: CaptureQueueApi = {
      listCaptures: vi.fn().mockResolvedValue([{ noteId: 'n9', clientId: 'c1', clientName: 'QA Sara Khan', statement: 'Remember that QA Sara Khan increased her budget to 2.2M', capturedAt: Date.parse('2026-10-19T08:00:00Z'), summary: "Sara's budget → 2.2M" }]),
      confirmCapture: vi.fn(), rejectCapture: vi.fn(),
    };
    const kept: KeptQueueApi = {
      listKept: vi.fn().mockResolvedValue([{ id: 'k1', promiseId: 'p9', clientId: 'c1', clientName: 'Omar Ali', message: 'Looks like you sent the options to Omar Ali. Mark done?', promise: { quote: "I'll send the options", date: '2026-10-01' }, delivery: { quote: 'Here are the options', date: '2026-10-03' }, createdAt: 1 }]),
      markKeptDone: vi.fn(), undoKept: vi.fn(), notYetKept: vi.fn(),
    };
    const { container } = render(<ConfirmChitQueue api={api} captures={captures} kept={kept} />);
    await screen.findByText('Send the floor plans');
    const cards = screen.getAllByRole('group');
    const line = (i: number) => within(cards[i]!).getByTestId('source-line');
    // newest first: the Ask capture (19 Oct), then the promise, then the kept suggestion
    expect(cards.map((_, i) => line(i).textContent)).toEqual([
      'Your note, 19 Oct 2026',
      'Sara Khan, 7 May 2026: “Great, I\'ll send you the floor plans tomorrow”',
      'Omar Ali, 1 Oct 2026: “I\'ll send the options”',
    ]);
    expect(screen.queryByText(/Here are the options/)).toBeNull(); // collapsed: one line
    await userEvent.click(line(2));
    expect(within(cards[2]!).getByText(/Here are the options/)).toBeInTheDocument(); // expanded: both messages
    expect(within(cards[2]!).getAllByText(/I'll send the options”/).length).toBe(2); // the line + the full promise receipt
    expect(container.textContent).not.toMatch(ISO);
  });
});
