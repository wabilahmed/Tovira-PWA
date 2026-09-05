import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MatchSuggestion } from './MatchSuggestion.js';
import type { MatchSuggestion as Match } from './inventoryClient.js';

const match: Match = {
  matchId: 'm1', itemId: 'i1', itemTitle: 'Marina Heights 402', clientId: 'c1',
  confidence: 'strong',
  receipt: { requirementRaw: 'looking for a 2-bed near the marina', statedOn: '2026-03-14', noteId: 'n1' },
};

describe('<MatchSuggestion>', () => {
  it('shows the item, a confidence WORD (no number), and the receipt inline', () => {
    render(<MatchSuggestion match={match} onShare={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('Marina Heights 402')).toBeInTheDocument();
    expect(screen.getByText('Strong match')).toBeInTheDocument(); // a word, not a percentage
    // The receipt (client's quoted words + date) is visible without any tap.
    expect(screen.getByTestId('receipt')).toHaveTextContent('looking for a 2-bed near the marina');
    // No similarity number is rendered anywhere.
    expect(document.body.textContent).not.toMatch(/\d+%/);
  });

  it('exposes both Share and Dismiss, wired to the callbacks', async () => {
    const user = userEvent.setup();
    const onShare = vi.fn();
    const onDismiss = vi.fn();
    render(<MatchSuggestion match={match} onShare={onShare} onDismiss={onDismiss} />);
    await user.click(screen.getByRole('button', { name: /share/i }));
    expect(onShare).toHaveBeenCalledWith('m1');
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith('m1');
  });

  it('labels a possible match as "Possible match"', () => {
    render(<MatchSuggestion match={{ ...match, confidence: 'possible' }} onShare={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('Possible match')).toBeInTheDocument();
  });
});
