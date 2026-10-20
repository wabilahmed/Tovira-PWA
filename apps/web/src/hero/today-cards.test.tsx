import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { HeroInsights, type HeroApi } from './HeroInsights.js';
import { ConfirmChitQueue, type ConfirmQueueApi, type CaptureQueueApi, type KeptQueueApi } from '../confirm/ConfirmChitQueue.js';
import type { TodayAction } from './heroClient.js';
import type { OpenPromise } from '../promises/promisesClient.js';

/**
 * [P34-2] Phone review, 20 Oct: "Due soon: Send the floor plans" didn't say for which client, and a client's own
 * promise read like the rep's task. Every Today entry and every To Confirm card names its client (bold), a
 * client-owned promise reads "<name> promised: …", and an item with genuinely no client reads "Your note".
 */
const heroApi = (actions: TodayAction[]): HeroApi => ({
  status: vi.fn().mockResolvedValue({ unlocked: true, counts: { clients: 5, notes: 20 }, needed: { clients: 0, notes: 0 }, message: '' }),
  patterns: vi.fn().mockResolvedValue([]),
  risk: vi.fn().mockResolvedValue([]),
  today: vi.fn().mockResolvedValue({ actions, refreshesRemaining: 2 }),
  refreshToday: vi.fn().mockResolvedValue(null),
});
const action = (o: Partial<TodayAction>): TodayAction => ({ kind: 'promise', priority: 3, text: 'Due soon: x', clientId: 'c1', subline: 'due 21 Oct 2026', ...o });
const promise = (o: Partial<OpenPromise>): OpenPromise => ({ id: 'p1', clientId: 'c1', text: 'Send the floor plans', owner: 'rep', dueDate: null, dueRaw: null, confidence: 'low', done: false, confirmed: false, ...o });

describe('[P34-2] Today entries name the client and whose action it is', () => {
  it('rep promise → "Sara Khan · Send the floor plans" with the due line; client promise → "Sara Khan promised: …"', async () => {
    render(<HeroInsights api={heroApi([
      action({ clientName: 'Sara Khan', title: 'Send the floor plans', owner: 'rep' }),
      action({ clientName: 'Sara Khan', title: 'Send ID document photos', owner: 'client', text: 'Due soon: Send ID document photos' }),
    ])} />);
    const [rep, client] = within(await screen.findByTestId('today-list')).getAllByRole('listitem');
    expect(rep).toHaveTextContent(/Sara Khan · Send the floor plans/);
    expect(rep).toHaveTextContent(/due 21 Oct 2026/);
    expect(within(rep!).getByText('Sara Khan').tagName).toBe('STRONG');
    expect(client).toHaveTextContent(/Sara Khan promised: Send ID document photos/);
    expect(rep).not.toHaveTextContent(/Due soon:/); // the date lives in the line below
  });

  it('no client → "Your note"', async () => {
    render(<HeroInsights api={heroApi([action({ clientId: null, clientName: null, title: 'Call the bank' })])} />);
    expect(await screen.findByTestId('today-list')).toHaveTextContent(/Your note · Call the bank/);
  });
});

describe('[P34-2] every To Confirm card names its client', () => {
  it('promise (rep / client-owned / no client), Ask capture and kept suggestion all carry a client name or "Your note"', async () => {
    const api: ConfirmQueueApi = {
      listConfirmations: vi.fn().mockResolvedValue([
        promise({ id: 'p1', clientName: 'Sara Khan', owner: 'rep', text: 'Send the floor plans' }),
        promise({ id: 'p2', clientName: 'Sara Khan', owner: 'client', text: 'Send ID document photos' }),
        promise({ id: 'p3', clientName: null, text: 'Renew the trade licence' }),
      ]),
      confirm: vi.fn(), reject: vi.fn(),
    };
    const captures: CaptureQueueApi = {
      listCaptures: vi.fn().mockResolvedValue([{ noteId: 'n9', clientId: 'c1', clientName: 'QA Sara Khan', statement: 'Remember that…', capturedAt: Date.parse('2026-10-19T08:00:00Z'), summary: "Sara's budget → 2.2M" }]),
      confirmCapture: vi.fn(), rejectCapture: vi.fn(),
    };
    const kept: KeptQueueApi = {
      listKept: vi.fn().mockResolvedValue([{ id: 'k1', promiseId: 'p9', clientId: 'c1', clientName: 'Omar Ali', message: 'Looks like you sent the options to Omar Ali. Mark done?', promise: { quote: "I'll send the options", date: '2026-10-01' }, delivery: { quote: 'Here are the options', date: '2026-10-03' } }]),
      markKeptDone: vi.fn(), undoKept: vi.fn(), notYetKept: vi.fn(),
    };
    render(<ConfirmChitQueue api={api} captures={captures} kept={kept} />);
    await screen.findByText('Send the floor plans');
    const cards = screen.getAllByRole('group');
    expect(cards).toHaveLength(5);
    const texts = cards.map((c) => c.textContent ?? '');
    expect(texts.some((t) => t.includes('Sara Khan — Send the floor plans'))).toBe(true);
    expect(texts.some((t) => t.includes('Sara Khan promised: Send ID document photos'))).toBe(true);
    expect(texts.some((t) => t.includes('Your note — Renew the trade licence'))).toBe(true);
    expect(texts.some((t) => t.includes("QA Sara Khan — Sara's budget → 2.2M"))).toBe(true);
    expect(texts.some((t) => t.includes('Omar Ali — Looks like you sent the options'))).toBe(true);
    for (const c of cards) expect(c.querySelector('strong')).not.toBeNull(); // the name is bold on every card
  });
});
