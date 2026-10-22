import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { meetingDateCopy } from './cardCopy.js';
import { ConfirmChitQueue, type ConfirmQueueApi, type DateConfirmApi } from './ConfirmChitQueue.js';
import type { MeetingToConfirm } from '../promises/promisesClient.js';

/** [P40-1 · owner] Meetings get the same question card, with the same limit (server) and grouping (here). */
const M: MeetingToConfirm = { id: 'm1', clientId: 'c1', clientName: 'Sara Khan', title: null, datetimeRaw: 'Saturday afternoon', noteId: 'n1', sourceSpan: 'see you Saturday afternoon', sourceMessageAt: '2026-10-08T10:00', captureAt: '2026-10-08', suggestedDatetime: null, createdAt: 1 };
const none: ConfirmQueueApi = { listConfirmations: vi.fn().mockResolvedValue([]), confirm: vi.fn(), reject: vi.fn() };
const api = (list: MeetingToConfirm[]) => ({
  listDatesToConfirm: vi.fn().mockResolvedValue([]), answerDate: vi.fn(),
  listMeetingDatesToConfirm: vi.fn().mockResolvedValue(list), answerMeetingDate: vi.fn().mockResolvedValue(true),
}) satisfies DateConfirmApi;

describe('[P40-1] meetingDateCopy', () => {
  it('"When is the meeting with Sara Khan?" and what was said, when', () => {
    expect(meetingDateCopy(M)).toEqual({ question: 'When is the meeting with Sara Khan?', said: "The chat said 'Saturday afternoon' on Thu 8 Oct." });
    expect(meetingDateCopy({ ...M, title: 'viewing' }).question).toBe('When is the viewing with Sara Khan?');
  });
});

describe('[P40-1] the meeting date card', () => {
  it('question, phrase, a time picker, Not sure, No date yet; a suggestion only when the resolver has one', async () => {
    render(<ConfirmChitQueue api={none} dates={api([M])} />);
    const card = await screen.findByRole('group', { name: 'Meeting time to confirm' });
    expect(within(card).getByText('When is the meeting with Sara Khan?')).toBeInTheDocument();
    expect(within(card).getByLabelText('Pick a date and time')).toHaveAttribute('type', 'datetime-local');
    expect(within(card).getByRole('button', { name: 'Not sure' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'No date yet' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /^Yes,/ })).toBeNull();
  });

  it('the suggested time answers it', async () => {
    const a = api([{ ...M, datetimeRaw: 'Saturday 3pm', suggestedDatetime: '2026-10-10T15:00' }]);
    render(<ConfirmChitQueue api={none} dates={a} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, Sat 10 Oct, 15:00' }));
    expect(a.answerMeetingDate).toHaveBeenCalledWith('m1', { datetime: '2026-10-10T15:00' });
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Meeting time to confirm' })).toBeNull());
  });

  it('"No date yet" is an answer', async () => {
    const a = api([M]);
    render(<ConfirmChitQueue api={none} dates={a} />);
    await userEvent.click(await screen.findByRole('button', { name: 'No date yet' }));
    expect(a.answerMeetingDate).toHaveBeenCalledWith('m1', { dateStatus: 'no_date' });
  });

  it('more than 3 from one import → "4 meetings need a date", opening the list; 3 → separate cards', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...M, id: `m${i}` }));
    const { unmount } = render(<ConfirmChitQueue api={none} dates={api(many(4))} />);
    const group = await screen.findByRole('group', { name: 'Meeting times to confirm' });
    expect(within(group).getByText('4 meetings need a date')).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: 'Answer them' }));
    expect(within(group).getAllByRole('group', { name: 'Meeting time to confirm' })).toHaveLength(4);
    unmount();
    render(<ConfirmChitQueue api={none} dates={api(many(3))} />);
    expect(await screen.findAllByRole('group', { name: 'Meeting time to confirm' })).toHaveLength(3);
  });
});
