import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceiptThread, ReceiptsProvider } from './ReceiptThread.js';
import type { ReceiptsApi, ReceiptSource } from './receiptsClient.js';

/**
 * [P35-3 fix] The source bubble shows at once from the stored quote, but "Show the conversation" used to appear
 * only after the chat source loaded — a rep tapping early found nothing to tap (and the Today receipt test raced
 * on a busy machine). A receipt with a note to open offers the tap from the first render; tapping before the
 * source arrives loads the conversation around it.
 */
const thread: ReceiptSource = {
  kind: 'chat', noteId: 'n1', repKnown: true, hasMore: false,
  bubbles: [
    { sender: 'Sara Khan', side: 'other', at: '2026-05-07T11:10', text: 'Can you send the floor plans?', source: false },
    { sender: 'Wabil', side: 'rep', at: '2026-05-07T11:15', text: "Great, I'll send you the floor plans tomorrow", source: true },
  ],
};

describe('[P35-3] "Show the conversation" before the source has loaded', () => {
  it('is there from the first render and opens the conversation', async () => {
    const api: ReceiptsApi = { source: () => new Promise<ReceiptSource | null>(() => {}), thread: vi.fn(async () => thread) };
    render(<ReceiptsProvider api={api}><ReceiptThread refInfo={{ noteId: 'n1', quote: "Great, I'll send you the floor plans tomorrow" }} /></ReceiptsProvider>);
    expect(screen.getByText("Great, I'll send you the floor plans tomorrow")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /show the conversation/i }));
    expect(await screen.findByText('Can you send the floor plans?')).toBeInTheDocument();
    expect(api.thread).toHaveBeenCalledWith({ noteId: 'n1', quote: "Great, I'll send you the floor plans tomorrow" }, false);
  });

  it('NEGATIVE: a quote with no note to open offers no tap', () => {
    const api: ReceiptsApi = { source: () => new Promise<ReceiptSource | null>(() => {}), thread: vi.fn(async () => null) };
    render(<ReceiptsProvider api={api}><ReceiptThread refInfo={{ quote: 'Just a quote' }} /></ReceiptsProvider>);
    expect(screen.queryByRole('button', { name: /show the conversation/i })).toBeNull();
  });
});
