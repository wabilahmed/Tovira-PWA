import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmChitQueue, type ConfirmQueueApi, type CaptureQueueApi } from './ConfirmChitQueue.js';

/** [P21-A3] A statement held from Ask appears in To Confirm next to the guessed promises. */
const none: ConfirmQueueApi = { listConfirmations: vi.fn().mockResolvedValue([]), confirm: vi.fn(), reject: vi.fn() };
function captures(): CaptureQueueApi {
  return {
    listCaptures: vi.fn().mockResolvedValue([{ noteId: 'n9', clientId: 'c1', clientName: 'QA Sara Khan', statement: 'Remember that QA Sara Khan increased her budget to 2.2M', capturedAt: 0, summary: "Sara's budget → 2.2M", field: 'budget', value: '2.2M' }]),
    confirmCapture: vi.fn().mockResolvedValue(true),
    rejectCapture: vi.fn().mockResolvedValue(true),
  };
}

describe('[P21-A3] <ConfirmChitQueue> shows Ask captures', () => {
  it('lists a held Ask statement and confirms it via the capture endpoint', async () => {
    const cap = captures();
    render(<ConfirmChitQueue api={none} captures={cap} />);
    // [P39-6 · owner] asked as a question (was "QA Sara Khan — Sara's budget → 2.2M" with Confirm / Not right).
    expect(await screen.findByText("Did QA Sara Khan's budget change to AED 2.2M?")).toBeInTheDocument();
    expect(screen.getByText('Yes updates their budget.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Needs your answer' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, update it' }));
    expect(cap.confirmCapture).toHaveBeenCalledWith('n9');
    await waitFor(() => expect(screen.queryByText(/budget change/)).toBeNull());
  });

  it('rejecting a held statement uses the capture reject endpoint', async () => {
    const cap = captures();
    render(<ConfirmChitQueue api={none} captures={cap} />);
    await screen.findByText(/budget change to AED 2\.2M/);
    await userEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(cap.rejectCapture).toHaveBeenCalledWith('n9');
    expect(none.reject).not.toHaveBeenCalled();
  });
});
