import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientInventory, type ClientInventoryApi } from './ClientInventory.js';
import type { SharedWithClient } from './inventoryClient.js';

const shared = (over: Partial<SharedWithClient>): SharedWithClient => ({
  id: 's1', itemId: 'i1', clientId: 'c1', sharedAt: Date.now(), outcome: 'bought',
  outcomeSetBy: 'rep', quantityBought: 1, itemTitle: 'Marina 402', itemStatus: 'active', ...over,
});

describe('<ClientInventory>', () => {
  it('renders nothing when nothing has been shared with the client', () => {
    const api: ClientInventoryApi = { sharesForClient: vi.fn().mockResolvedValue([]) };
    const { container } = render(<ClientInventory api={api} clientId="c1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists items shared with the client, with their outcome', async () => {
    const api: ClientInventoryApi = { sharesForClient: vi.fn().mockResolvedValue([shared({})]) };
    render(<ClientInventory api={api} clientId="c1" />);
    expect(await screen.findByText('Marina 402')).toBeInTheDocument();
    expect(screen.getByText('BOUGHT')).toBeInTheDocument();
  });
});
