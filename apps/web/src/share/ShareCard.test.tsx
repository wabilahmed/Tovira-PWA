import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareCard, type ShareCardApi } from './ShareCard.js';
import type { ShareCardStats } from './shareCardClient.js';

const api = (c: ShareCardStats | null): ShareCardApi => ({ get: vi.fn().mockResolvedValue(c) });
const full: ShareCardStats = { openPromises: 7, unansweredQuestions: 3, goingCold: 2, upcomingDates: 0, total: 12 };

describe('<ShareCard>', () => {
  it('shows the stats (counts only) — non-zero rows', async () => {
    render(<ShareCard api={api(full)} origin="https://tovira.app" />);
    const stats = await screen.findByTestId('share-stats');
    expect(stats).toHaveTextContent(/7 open promises/i);
    expect(stats).toHaveTextContent(/3 unanswered questions/i);
    expect(stats).not.toHaveTextContent(/upcoming dates/i); // zero rows hidden
  });

  it('renders the referral link with the rep\'s code and copies it', async () => {
    const user = userEvent.setup();
    const onShare = vi.fn();
    render(<ShareCard api={api(full)} referralCode="user-123" origin="https://tovira.app" onShare={onShare} />);
    await screen.findByTestId('referral-link');
    expect(screen.getByTestId('referral-link')).toHaveTextContent('https://tovira.app/?ref=user-123');
    await user.click(screen.getByRole('button', { name: /copy link/i }));
    expect(onShare).toHaveBeenCalledWith('https://tovira.app/?ref=user-123');
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument();
  });

  it('renders nothing when there is nothing to show', async () => {
    const { container } = render(<ShareCard api={api({ openPromises: 0, unansweredQuestions: 0, goingCold: 0, upcomingDates: 0, total: 0 })} />);
    await waitFor(() => expect(container.querySelector('[aria-label="Share card"]')).toBeNull());
  });

  it('shows no referral section without a code', async () => {
    render(<ShareCard api={api(full)} />);
    await screen.findByTestId('share-stats');
    expect(screen.queryByTestId('referral-link')).toBeNull();
  });
});
