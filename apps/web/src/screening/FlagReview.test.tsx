import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FlagReview } from './FlagReview.js';
import type { FlagReviewData, ScreeningApi } from './screeningClient.js';

const DATA: FlagReviewData = {
  held: 3,
  groups: [
    { category: 'political_opinion', count: 2, spans: [{ span: 'party', count: 2, messages: [
      { index: 0, sender: 'Client', sentAt: 't', body: 'the party is on Friday' },
      { index: 1, sender: 'Client', sentAt: 't', body: 'another party next week' },
    ] }] },
    { category: 'health', count: 1, spans: [{ span: 'hospital', count: 1, messages: [
      { index: 2, sender: 'Client', sentAt: 't', body: 'he is in hospital' },
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
  it('renders held messages grouped category → span with counts and bodies', async () => {
    render(<FlagReview noteId="n1" api={stubApi()} />);
    expect(await screen.findByTestId('flag-review')).toBeInTheDocument();
    expect(screen.getByTestId('flag-category-political_opinion')).toHaveTextContent(/Political opinion/);
    expect(screen.getByTestId('flag-span-political_opinion-party')).toHaveTextContent(/party/);
    expect(screen.getByText('the party is on Friday')).toBeInTheDocument();
    expect(screen.getByText('he is in hospital')).toBeInTheDocument();
  });

  it('carries only the FIRST coverage sentence inside the list', async () => {
    render(<FlagReview noteId="n1" api={stubApi()} />);
    await screen.findByTestId('flag-review');
    const notice = screen.getByTestId('held-notice').textContent ?? '';
    expect(notice).toMatch(/decide before they're analysed/i);
    expect(notice).not.toMatch(/read the conversation, not just the flags/i);
  });

  it('bulk-by-span restores the dominant token in one action', async () => {
    const api = stubApi();
    render(<FlagReview noteId="n1" api={api} onRestored={vi.fn()} />);
    await screen.findByTestId('flag-review');
    fireEvent.click(screen.getByTestId('span-restore-political_opinion-party'));
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith('n1', { category: 'political_opinion', span: 'party' }));
    expect(api.flags).toHaveBeenCalledTimes(2); // reloaded after restore
  });

  it('bulk-by-category and per-message restore call the right selector', async () => {
    const api = stubApi();
    render(<FlagReview noteId="n1" api={api} />);
    await screen.findByTestId('flag-review');
    fireEvent.click(screen.getByTestId('category-restore-health'));
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith('n1', { category: 'health' }));
    fireEvent.click(screen.getByTestId('msg-restore-2'));
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith('n1', { index: 2 }));
  });

  it('notifies the parent on a successful restore (so the scan/indicator can update)', async () => {
    const onRestored = vi.fn();
    render(<FlagReview noteId="n1" api={stubApi()} onRestored={onRestored} />);
    await screen.findByTestId('flag-review');
    fireEvent.click(screen.getByTestId('span-restore-political_opinion-party'));
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
  });

  it('renders nothing when nothing is held', async () => {
    const api = stubApi({ flags: vi.fn(async () => ({ held: 0, groups: [] })) });
    const { container } = render(<FlagReview noteId="n1" api={api} />);
    await waitFor(() => expect(screen.queryByTestId('flag-review-loading')).not.toBeInTheDocument());
    expect(container.querySelector('[data-testid="flag-review"]')).toBeNull();
  });
});
