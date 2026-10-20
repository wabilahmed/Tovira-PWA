import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeroInsights, type HeroApi } from './HeroInsights.js';
import { ConfirmChitQueue, type ConfirmQueueApi, type CaptureQueueApi, type KeptQueueApi } from '../confirm/ConfirmChitQueue.js';
import { ReceiptsProvider } from '../receipts/ReceiptThread.js';
import type { ReceiptSource, ReceiptsApi, ReceiptRef } from '../receipts/receiptsClient.js';
import type { TodayAction } from './heroClient.js';
import type { OpenPromise } from '../promises/promisesClient.js';

/**
 * [P34-7 → P35-3] Every Today entry and To Confirm card shows where it came from. P34-7 did that as a one-line
 * source; P35-3 (owner, 20 Oct) replaced it with the shared WhatsApp-style receipt: the SOURCE MESSAGE as a chat
 * bubble (compact on cards), a tap opening the conversation — a kept-promise suggestion also showing the delivery
 * message. No ISO dates anywhere; the text exactly as stored. A card with no saved source says so plainly.
 */
const ISO = /\d{4}-\d{2}-\d{2}T/;
const bubbleFor = (ref: ReceiptRef): ReceiptSource => ({
  kind: 'chat', noteId: ref.noteId ?? null, repKnown: true, hasMore: false,
  bubbles: [
    { sender: 'Sara Khan', side: 'other', at: '2026-05-07T11:10', text: 'Can you send the floor plans?', source: false },
    { sender: 'Wabil', side: 'rep', at: ref.at && ref.at.includes('T') ? ref.at : '2026-05-07T11:15', text: ref.quote ?? ref.span ?? '', source: true },
  ],
});
const receipts: ReceiptsApi = { source: async (ref) => bubbleFor(ref), thread: vi.fn(async (ref: ReceiptRef) => bubbleFor(ref)) };
const inProvider = (el: JSX.Element) => render(<ReceiptsProvider api={receipts}>{el}</ReceiptsProvider>);

const heroApi = (actions: TodayAction[]): HeroApi => ({
  status: vi.fn().mockResolvedValue({ unlocked: true, counts: { clients: 5, notes: 20 }, needed: { clients: 0, notes: 0 }, message: '' }),
  patterns: vi.fn().mockResolvedValue([]),
  risk: vi.fn().mockResolvedValue([]),
  today: vi.fn().mockResolvedValue({ actions, refreshesRemaining: 2 }),
  refreshToday: vi.fn().mockResolvedValue(null),
});
const action = (o: Partial<TodayAction>): TodayAction => ({ kind: 'promise', priority: 3, text: 'x', clientId: 'c1', clientName: 'Sara Khan', title: 'Send the floor plans', owner: 'rep', subline: 'due 21 Oct 2026', ...o });

describe('[P35-3] every Today entry shows its source as a chat bubble', () => {
  it('message / own-note / cooling / no-span / not-yet-rebuilt entries: a source bubble, or an honest line; no ISO', async () => {
    const { container } = inProvider(<HeroInsights api={heroApi([
      action({ receipt: { quote: "Great, I'll send you the floor plans tomorrow", source: 'message', at: '2026-05-07T11:15', noteId: 'n1' } }),
      action({ title: 'Call the developer', receipt: { quote: 'I will call the developer on Sunday', source: 'capture', at: '2026-10-19', noteId: 'n2' } }),
      action({ kind: 'cold', clientName: 'Omar Ali', title: 'Reach out — going cold', subline: 'silent 45 days', receipt: { quote: null, source: 'contact', at: '2026-09-05' } }),
      action({ title: 'Old fact', receipt: { quote: null, source: 'none', at: null } }),
      action({ title: 'Cached before receipts' }),
    ])} />);
    const items = within(await screen.findByTestId('today-list')).getAllByRole('listitem');
    expect(items).toHaveLength(5); // the receipt bubbles are not list items of Today
    await within(items[0]!).findByText("Great, I'll send you the floor plans tomorrow");
    expect(within(items[0]!).getAllByTestId('bubble')).toHaveLength(1); // compact: the source message only
    expect(within(items[0]!).getByTestId('bubble')).toHaveAttribute('data-source', 'true');
    await within(items[1]!).findByText('I will call the developer on Sunday');
    expect(within(items[2]!).getByTestId('receipt-empty')).toHaveTextContent('Last contact 5 Sep 2026');
    expect(within(items[3]!).getByTestId('receipt-empty')).toHaveTextContent('No source quote was saved for this fact');
    expect(within(items[4]!).getByTestId('receipt-empty')).toHaveTextContent('Source shows after the next refresh');
    expect(container.textContent).not.toMatch(ISO);
  });

  it('a tap opens the conversation around the source message', async () => {
    inProvider(<HeroInsights api={heroApi([action({ receipt: { quote: "Great, I'll send you the floor plans tomorrow", source: 'message', at: '2026-05-07T11:15', noteId: 'n1' } })])} />);
    await screen.findByText("Great, I'll send you the floor plans tomorrow");
    // [owner-approved, 20 Oct] the conversation loads asynchronously — wait for it (same assertions).
    await userEvent.click(await screen.findByRole('button', { name: /show the conversation/i }));
    expect(await screen.findAllByTestId('bubble')).toHaveLength(2);
    expect(screen.getByText('Can you send the floor plans?')).toBeInTheDocument();
  });
});

describe('[P35-3] every To Confirm card shows its source as a chat bubble', () => {
  it('promise, Ask capture and kept suggestion (tap → the delivery message too); no ISO', async () => {
    const promise: OpenPromise = {
      id: 'p1', clientId: 'c1', clientName: 'Sara Khan', text: 'Send the floor plans', owner: 'rep', dueDate: null, dueRaw: null, confidence: 'low', done: false, confirmed: false, createdAt: 3,
      noteId: 'n1', sourceSpan: "Great, I'll send you the floor plans tomorrow", sourceMessageAt: '2026-05-07T11:15',
      receipt: { quote: "Great, I'll send you the floor plans tomorrow", source: 'message', at: '2026-05-07T11:15', label: '' },
    };
    const api: ConfirmQueueApi = { listConfirmations: vi.fn().mockResolvedValue([promise]), confirm: vi.fn(), reject: vi.fn() };
    const captures: CaptureQueueApi = {
      listCaptures: vi.fn().mockResolvedValue([{ noteId: 'n9', clientId: 'c1', clientName: 'QA Sara Khan', statement: 'Remember that QA Sara Khan increased her budget to 2.2M', capturedAt: Date.parse('2026-10-19T08:00:00Z'), summary: "Sara's budget → 2.2M" }]),
      confirmCapture: vi.fn(), rejectCapture: vi.fn(),
    };
    const kept: KeptQueueApi = {
      listKept: vi.fn().mockResolvedValue([{ id: 'k1', promiseId: 'p9', clientId: 'c1', clientName: 'Omar Ali', message: 'Looks like you sent the options to Omar Ali. Mark done?', promise: { quote: "I'll send the options", date: '2026-10-01' }, delivery: { quote: 'Here are the options', date: '2026-10-03' }, createdAt: 1, noteId: 'n5', promiseAt: '2026-10-01T09:00', deliveryAt: '2026-10-03T10:00' }]),
      markKeptDone: vi.fn(), undoKept: vi.fn(), notYetKept: vi.fn(),
    };
    const { container } = inProvider(<ConfirmChitQueue api={api} captures={captures} kept={kept} />);
    await screen.findByText("Great, I'll send you the floor plans tomorrow");
    await screen.findByText('Remember that QA Sara Khan increased her budget to 2.2M');
    const cards = screen.getAllByRole('group');
    expect(cards).toHaveLength(3);
    for (const c of cards) expect(within(c).getAllByTestId('receipt-thread').length).toBeGreaterThan(0);
    const keptCard = cards.find((c) => c.textContent?.includes('Omar Ali'))!;
    expect(within(keptCard).queryByText('Here are the options')).toBeNull(); // compact: the promise only
    await userEvent.click(within(keptCard).getByRole('button', { name: /show the conversation/i }));
    expect(await within(keptCard).findByText('Here are the options')).toBeInTheDocument(); // + the delivery message
    expect(container.textContent).not.toMatch(ISO);
  });
});
