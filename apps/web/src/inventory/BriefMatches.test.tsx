import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BriefMatches, type BriefMatchApi } from './BriefMatches.js';
import type { MatchSuggestion as Match } from './inventoryClient.js';

const sugg = (over: Partial<Match> = {}): Match => ({
  matchId: 'm1', itemId: 'i1', itemTitle: 'Marina Heights 402', clientId: 'c1',
  confidence: 'strong',
  receipt: { requirementRaw: 'looking for a 2-bed near the marina', statedOn: '2026-03-14', noteId: 'n1' },
  ...over,
});

function makeApi(over: Partial<BriefMatchApi> = {}): BriefMatchApi {
  return {
    matches: vi.fn().mockResolvedValue({ suggestions: [sugg()], badge: 1 }),
    shareFromSuggestion: vi.fn().mockResolvedValue(null),
    dismissMatch: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

describe('<BriefMatches> (INV-MATCH — the brief, primary surface)', () => {
  it('fetches the client scope and renders each suggestion with its receipt', async () => {
    const api = makeApi();
    render(<BriefMatches api={api} clientId="c1" />);
    expect(api.matches).toHaveBeenCalledWith('c1');
    expect(await screen.findByText('Marina Heights 402')).toBeInTheDocument();
    expect(screen.getByTestId('receipt')).toHaveTextContent('looking for a 2-bed near the marina');
  });

  it('renders nothing when there are no suggestions', async () => {
    const api = makeApi({ matches: vi.fn().mockResolvedValue({ suggestions: [], badge: 0 }) });
    const { container } = render(<BriefMatches api={api} clientId="c1" />);
    await waitFor(() => expect(api.matches).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="brief-matches"]')).toBeNull();
  });

  it('sharing a suggestion calls share then reloads (the shared match drops off)', async () => {
    const user = userEvent.setup();
    const matches = vi.fn()
      .mockResolvedValueOnce({ suggestions: [sugg()], badge: 1 })
      .mockResolvedValueOnce({ suggestions: [], badge: 0 });
    const api = makeApi({ matches, shareFromSuggestion: vi.fn().mockResolvedValue({ share: {}, warning: null }) });
    render(<BriefMatches api={api} clientId="c1" />);
    await user.click(await screen.findByRole('button', { name: /share/i }));
    expect(api.shareFromSuggestion).toHaveBeenCalledWith('m1');
    await waitFor(() => expect(screen.queryByText('Marina Heights 402')).not.toBeInTheDocument());
  });

  it('dismissing a suggestion calls dismiss then reloads', async () => {
    const user = userEvent.setup();
    const matches = vi.fn()
      .mockResolvedValueOnce({ suggestions: [sugg()], badge: 1 })
      .mockResolvedValueOnce({ suggestions: [], badge: 0 });
    const api = makeApi({ matches });
    render(<BriefMatches api={api} clientId="c1" />);
    await user.click(await screen.findByRole('button', { name: /dismiss/i }));
    expect(api.dismissMatch).toHaveBeenCalledWith('m1');
    await waitFor(() => expect(screen.queryByText('Marina Heights 402')).not.toBeInTheDocument());
  });
});
