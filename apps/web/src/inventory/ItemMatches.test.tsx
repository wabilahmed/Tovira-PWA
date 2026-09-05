import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ItemMatches, type ItemMatchApi } from './ItemMatches.js';
import type { MatchSuggestion as Match } from './inventoryClient.js';

const sugg = (over: Partial<Match> = {}): Match => ({
  matchId: 'm1', itemId: 'i1', itemTitle: 'Marina Heights 402', clientId: 'c1',
  confidence: 'strong',
  receipt: { requirementRaw: 'wants a 2-bed near the marina', statedOn: '2026-03-14', noteId: 'n1' },
  ...over,
});

function makeApi(over: Partial<ItemMatchApi> = {}): ItemMatchApi {
  return {
    itemMatches: vi.fn().mockResolvedValue([sugg()]),
    shareFromSuggestion: vi.fn().mockResolvedValue({ share: {}, warning: null }),
    dismissMatch: vi.fn().mockResolvedValue(true),
    ...over,
  };
}
const names: Record<string, string> = { c1: 'Ahmed Kareem' };
const clientName = (id: string): string => names[id] ?? 'a client';

describe('<ItemMatches> (INV-MATCH — reverse, on an item)', () => {
  it('names the CLIENT (not the item) and shows their requirement receipt', async () => {
    const api = makeApi();
    render(<ItemMatches api={api} itemId="i1" clientName={clientName} />);
    expect(api.itemMatches).toHaveBeenCalledWith('i1');
    expect(await screen.findByText('Ahmed Kareem')).toBeInTheDocument();
    expect(screen.queryByText('Marina Heights 402')).not.toBeInTheDocument(); // the item is known here
    expect(screen.getByTestId('receipt')).toHaveTextContent('wants a 2-bed near the marina');
    expect(screen.getByText(/1 client asked for something like this/)).toBeInTheDocument();
  });

  it('renders nothing when no client asked', async () => {
    const api = makeApi({ itemMatches: vi.fn().mockResolvedValue([]) });
    const { container } = render(<ItemMatches api={api} itemId="i1" clientName={clientName} />);
    await waitFor(() => expect(api.itemMatches).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="item-matches"]')).toBeNull();
  });

  it('sharing offers this item to that client, then reloads', async () => {
    const user = userEvent.setup();
    const itemMatches = vi.fn().mockResolvedValueOnce([sugg()]).mockResolvedValueOnce([]);
    const api = makeApi({ itemMatches });
    render(<ItemMatches api={api} itemId="i1" clientName={clientName} />);
    await user.click(await screen.findByRole('button', { name: /share/i }));
    expect(api.shareFromSuggestion).toHaveBeenCalledWith('m1');
    await waitFor(() => expect(screen.queryByText('Ahmed Kareem')).not.toBeInTheDocument());
  });
});
