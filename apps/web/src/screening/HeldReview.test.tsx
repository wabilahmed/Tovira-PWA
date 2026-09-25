import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HeldReview } from './HeldReview.js';
import type { FlagReviewData, ScreeningApi } from './screeningClient.js';

const FLAGS: FlagReviewData = {
  held: 2,
  groups: [{ category: 'health', count: 2, spans: [{ span: 'hospital', count: 2, messages: [
    { index: 0, sender: 'Client', sentAt: 't', body: 'he is in hospital' },
    { index: 1, sender: 'Client', sentAt: 't', body: 'back from hospital' },
  ] }] }],
};

function stubApi(over: Partial<ScreeningApi> = {}): ScreeningApi {
  return {
    held: vi.fn(async () => [{ noteId: 'n1', clientId: 'c1', held: 2 }]),
    flags: vi.fn(async () => FLAGS),
    restore: vi.fn(async () => ({ restored: 1, status: 'pending_extraction' })),
    ...over,
  };
}
const name = (id: string) => (id === 'c1' ? 'Marina Estates' : id);

describe('<HeldReview>', () => {
  it('shows the FULL coverage line, the held count, the client, and the review — beside the scan', async () => {
    render(<HeldReview api={stubApi()} clientName={name} />);
    expect(await screen.findByTestId('held-review')).toBeInTheDocument();
    const notices = screen.getAllByTestId('held-notice').map((n) => n.textContent ?? '');
    expect(notices.some((t) => /read the conversation, not just the flags/i.test(t))).toBe(true); // full line present
    expect(notices.some((t) => /2 messages held/i.test(t))).toBe(true); // persistent indicator
    expect(screen.getByTestId('held-client-n1')).toHaveTextContent('Marina Estates');
    expect(await screen.findByTestId('flag-review')).toBeInTheDocument();
  });

  it('renders nothing when nothing is held', async () => {
    const { container } = render(<HeldReview api={stubApi({ held: vi.fn(async () => []) })} clientName={name} />);
    await waitFor(() => expect(container.querySelector('[data-testid="held-review"]')).toBeNull());
  });

  it('reloads the held list and notifies the parent after a restore (so the scan can update)', async () => {
    const api = stubApi();
    const onChanged = vi.fn();
    render(<HeldReview api={api} clientName={name} onChanged={onChanged} />);
    await screen.findByTestId('flag-review');
    fireEvent.click(screen.getByTestId('msg-restore-0'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.held).toHaveBeenCalledTimes(2); // initial + reload after restore
  });
});
