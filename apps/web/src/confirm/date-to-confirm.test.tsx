import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { dateCopy } from './cardCopy.js';
import { ConfirmChitQueue, type ConfirmQueueApi, type DateConfirmApi } from './ConfirmChitQueue.js';
import type { OpenPromise } from '../promises/promisesClient.js';

/**
 * [P40-1] "When is the floor plans promise due? You said 'Sunday morning' on Sat 10 Oct." — a suggested date only
 * when the resolver has one, a date picker, Not sure and No due date.
 */
const P: OpenPromise = {
  id: 'p1', clientId: 'c1', clientName: 'Sara Khan', text: 'Send the floor plans', owner: 'rep', dueDate: null, dueRaw: 'Sunday morning',
  confidence: 'high', done: false, confirmed: true, dateStatus: 'to_confirm', suggestedDate: '2026-10-11', sourceMessageAt: '2026-10-10T10:05',
  receipt: { quote: "Sure, I'll send them Sunday morning", source: 'message', at: '2026-10-10T10:05', label: '' },
};
const none: ConfirmQueueApi = { listConfirmations: vi.fn().mockResolvedValue([]), confirm: vi.fn(), reject: vi.fn() };
const datesApi = (list: OpenPromise[]): DateConfirmApi & { answerDate: ReturnType<typeof vi.fn> } => ({ listDatesToConfirm: vi.fn().mockResolvedValue(list), answerDate: vi.fn().mockResolvedValue(true) });

describe('[P40-1] dateCopy', () => {
  it('the owner\'s example, exactly', () => {
    expect(dateCopy(P)).toEqual({ question: 'When is the floor plans promise due?', said: "You said 'Sunday morning' on Sat 10 Oct." });
  });
  it('a client\'s promise names who said it; a text with no verb is quoted', () => {
    expect(dateCopy({ ...P, owner: 'client', text: 'Call back' }).said).toBe("Sara Khan said 'Sunday morning' on Sat 10 Oct.");
    expect(dateCopy({ ...P, text: 'The deposit' }).question).toBe("When is 'The deposit' due?");
  });
});

describe('[P40-1] the date card in Needs your answer', () => {
  it('renders the question, the phrase and its date, the receipt, and the four answers', async () => {
    render(<ConfirmChitQueue api={none} dates={datesApi([P])} />);
    const card = await screen.findByRole('group', { name: 'Date to confirm' });
    expect(within(card).getByText('When is the floor plans promise due?')).toBeInTheDocument();
    expect(within(card).getByText("You said 'Sunday morning' on Sat 10 Oct.")).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Yes, Sun 11 Oct' })).toBeInTheDocument();
    expect(within(card).getByLabelText('Pick a date')).toHaveAttribute('type', 'date');
    expect(within(card).getByRole('button', { name: 'Not sure' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'No due date' })).toBeInTheDocument();
  });

  it('no suggested-date button when the resolver has none', async () => {
    render(<ConfirmChitQueue api={none} dates={datesApi([{ ...P, suggestedDate: null }])} />);
    const card = await screen.findByRole('group', { name: 'Date to confirm' });
    expect(within(card).queryByRole('button', { name: /^Yes,/ })).toBeNull();
  });

  it('each answer goes to the server and the card leaves', async () => {
    for (const [click, sent] of [['Yes, Sun 11 Oct', { dueDate: '2026-10-11' }], ['Not sure', { dateStatus: 'not_sure' }], ['No due date', { dateStatus: 'no_due_date' }]] as const) {
      const api = datesApi([P]);
      const { unmount } = render(<ConfirmChitQueue api={none} dates={api} />);
      await userEvent.click(await screen.findByRole('button', { name: click }));
      expect(api.answerDate).toHaveBeenCalledWith('p1', sent);
      await waitFor(() => expect(screen.queryByRole('group', { name: 'Date to confirm' })).toBeNull());
      unmount();
    }
  });

  it('a picked date is sent as the answer', async () => {
    const api = datesApi([P]);
    render(<ConfirmChitQueue api={none} dates={api} />);
    const input = await screen.findByLabelText('Pick a date');
    await userEvent.type(input, '2026-10-12');
    await userEvent.click(screen.getByRole('button', { name: 'Save the date' }));
    expect(api.answerDate).toHaveBeenCalledWith('p1', { dueDate: '2026-10-12' });
  });
});

describe('[P40-1] "Date to confirm" wherever a date would show', () => {
  it('the client page\'s promise line', async () => {
    const { PromisesSection } = await import('../clients/page/Sections.js');
    render(<PromisesSection clientName="Sara Khan" clientId="c1" overview={{ promises: [{ id: 'p1', noteId: 'n1', text: 'Send the floor plans', owner: 'rep', dueDate: null, dateStatus: 'to_confirm', done: false, overdue: false, stale: false, sourceSpan: null, sourceMessageAt: null }] } as never} />);
    expect(screen.getByTestId('date-to-confirm')).toHaveTextContent('Date to confirm');
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });
});

describe('[P40-1 · owner] more than 3 from one import → one card that opens the list', () => {
  const many = (n: number, noteId: string) => Array.from({ length: n }, (_, i) => ({ ...P, id: `${noteId}-${i}`, noteId, text: `Send item ${i}` }));
  it('5 from one chat → one card, "5 promises need a due date", that opens the 5 questions', async () => {
    render(<ConfirmChitQueue api={none} dates={datesApi(many(5, 'n1'))} />);
    const group = await screen.findByRole('group', { name: 'Dates to confirm' });
    expect(within(group).getByText('5 promises need a due date')).toBeInTheDocument();
    expect(screen.queryAllByRole('group', { name: 'Date to confirm' })).toHaveLength(0);
    await userEvent.click(within(group).getByRole('button', { name: 'Answer them' }));
    expect(within(group).getAllByRole('group', { name: 'Date to confirm' })).toHaveLength(5);
  });
  it('exactly 3 from one chat → 3 separate cards (the edge)', async () => {
    render(<ConfirmChitQueue api={none} dates={datesApi(many(3, 'n1'))} />);
    expect(await screen.findAllByRole('group', { name: 'Date to confirm' })).toHaveLength(3);
    expect(screen.queryByRole('group', { name: 'Dates to confirm' })).toBeNull();
  });
  it('grouping is per import: 4 from one chat (grouped) and 1 from another (its own card)', async () => {
    render(<ConfirmChitQueue api={none} dates={datesApi([...many(4, 'n1'), ...many(1, 'n2')])} />);
    expect(await screen.findByText('4 promises need a due date')).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: 'Date to confirm' })).toHaveLength(1);
  });
});
