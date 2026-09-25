import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FlagReview } from './FlagReview.js';
import type { FlagReviewData, ScreeningApi, HeldMessageView } from './screeningClient.js';

// 11 "party" messages (>= the bulk threshold of 10) — ten birthdays and one that is NOT — plus a small
// 2-message health group (below the threshold). Previews let the rep see the odd one out at a glance.
const partyMsgs: HeldMessageView[] = Array.from({ length: 11 }, (_, i) => ({
  index: i, sender: 'Client', sentAt: 't',
  body: i === 7 ? 'he votes for the ruling party every time' : `birthday party on the ${i + 1}th`,
}));
const DATA: FlagReviewData = {
  held: 13,
  groups: [
    { category: 'political_opinion', count: 11, spans: [{ span: 'party', count: 11, messages: partyMsgs }] },
    { category: 'health', count: 2, spans: [{ span: 'hospital', count: 2, messages: [
      { index: 11, sender: 'Client', sentAt: 't', body: 'he is in hospital' },
      { index: 12, sender: 'Client', sentAt: 't', body: 'back from the hospital now' },
    ] }] },
  ],
};

function stubApi(over: Partial<ScreeningApi> = {}): ScreeningApi {
  return {
    flags: vi.fn(async () => DATA),
    restore: vi.fn(async () => ({ restored: 1, status: 'pending_extraction' })),
    ...over,
  };
}

describe('<FlagReview>', () => {
  it('renders held messages grouped category → span with counts and per-message previews', async () => {
    render(<FlagReview noteId="n1" api={stubApi()} />);
    expect(await screen.findByTestId('flag-review')).toBeInTheDocument();
    expect(screen.getByTestId('flag-category-political_opinion')).toHaveTextContent(/Political opinion/);
    // (bodies are split by the highlight <mark>, so assert on the group's concatenated textContent)
    expect(screen.getByTestId('flag-span-political_opinion-party').textContent).toMatch(/votes for the ruling party/i); // the odd one out is visible
    expect(screen.getByTestId('flag-span-health-hospital').textContent).toMatch(/he is in hospital/i);
  });

  it('highlights the matched span inside each preview, so the rep sees the match in context', async () => {
    render(<FlagReview noteId="n1" api={stubApi()} />);
    await screen.findByTestId('flag-review');
    const marks = screen.getAllByTestId('match');
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((m) => /party|hospital/i.test(m.textContent ?? ''))).toBe(true);
  });

  it('carries only the FIRST coverage sentence inside the list', async () => {
    render(<FlagReview noteId="n1" api={stubApi()} />);
    await screen.findByTestId('flag-review');
    const notice = screen.getByTestId('held-notice').textContent ?? '';
    expect(notice).toMatch(/decide before they're analysed/i);
    expect(notice).not.toMatch(/read the conversation, not just the flags/i);
  });

  it('offers bulk restore ONLY above the threshold — party (11) yes, hospital (2) no', async () => {
    render(<FlagReview noteId="n1" api={stubApi()} />);
    await screen.findByTestId('flag-review');
    // party group is >= 10 → bulk offered at span AND category level
    expect(screen.getByTestId('span-restore-political_opinion-party')).toBeInTheDocument();
    expect(screen.getByTestId('category-restore-political_opinion')).toBeInTheDocument();
    // health group is < 10 → NO bulk, individual restores only
    expect(screen.queryByTestId('span-restore-health-hospital')).not.toBeInTheDocument();
    expect(screen.queryByTestId('category-restore-health')).not.toBeInTheDocument();
    expect(screen.getByTestId('msg-restore-11')).toBeInTheDocument(); // individual still available
  });

  it('bulk-by-span restores the dominant token in one action and reloads', async () => {
    const api = stubApi();
    render(<FlagReview noteId="n1" api={api} onRestored={vi.fn()} />);
    await screen.findByTestId('flag-review');
    fireEvent.click(screen.getByTestId('span-restore-political_opinion-party'));
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith('n1', { category: 'political_opinion', span: 'party' }));
    expect(api.flags).toHaveBeenCalledTimes(2);
  });

  it('bulk-by-category and per-message restore call the right selector', async () => {
    const api = stubApi();
    render(<FlagReview noteId="n1" api={api} />);
    await screen.findByTestId('flag-review');
    fireEvent.click(screen.getByTestId('category-restore-political_opinion'));
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith('n1', { category: 'political_opinion' }));
    fireEvent.click(screen.getByTestId('msg-restore-11'));
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith('n1', { index: 11 }));
  });

  it('notifies the parent on a successful restore (so the scan/indicator can update)', async () => {
    const onRestored = vi.fn();
    render(<FlagReview noteId="n1" api={stubApi()} onRestored={onRestored} />);
    await screen.findByTestId('flag-review');
    fireEvent.click(screen.getByTestId('msg-restore-11'));
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
  });

  it('renders nothing when nothing is held', async () => {
    const api = stubApi({ flags: vi.fn(async () => ({ held: 0, groups: [] })) });
    const { container } = render(<FlagReview noteId="n1" api={api} />);
    await waitFor(() => expect(screen.queryByTestId('flag-review-loading')).not.toBeInTheDocument());
    expect(container.querySelector('[data-testid="flag-review"]')).toBeNull();
  });
});
