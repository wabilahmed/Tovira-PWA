import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inventory, type InventoryApi } from './Inventory.js';
import type { InventoryItem } from './inventoryClient.js';
import { LOCKED } from '../billing/gated.js';

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'i1', title: 'Marina 402', description: '2-bed, sea view', quantity: 3,
  status: 'active', disabledReason: null, createdAt: 1, updatedAt: 1, ...over,
});

describe('<Inventory>', () => {
  it('lists active items with their quantity', async () => {
    const api: InventoryApi = { list: vi.fn().mockResolvedValue([item({})]), create: vi.fn(), edit: vi.fn() };
    render(<Inventory api={api} onSubscribe={vi.fn()} />);
    expect(await screen.findByText('Marina 402')).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity')).toBeTruthy();
  });

  it('a disabled item shows its status stamp (UNLISTED / OUT OF STOCK) and a "Set quantity" action', async () => {
    const api: InventoryApi = {
      list: vi.fn().mockImplementation((s?: string) => Promise.resolve(s === 'disabled' ? [item({ id: 'd1', title: 'Sold villa', status: 'disabled', disabledReason: 'sold_out', quantity: 0 })] : [])),
      create: vi.fn(), edit: vi.fn(),
    };
    const user = userEvent.setup();
    render(<Inventory api={api} onSubscribe={vi.fn()} />);
    await user.click(await screen.findByRole('tab', { name: 'Disabled' }));
    expect(await screen.findByText('OUT OF STOCK')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set quantity' })).toBeInTheDocument();
  });

  it('adding an item calls create with the entered fields', async () => {
    const api: InventoryApi = { list: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue(item({})), edit: vi.fn() };
    const user = userEvent.setup();
    render(<Inventory api={api} onSubscribe={vi.fn()} />);
    await user.type(screen.getByLabelText('Item title'), 'New listing');
    await user.type(screen.getByLabelText('Item description'), 'a description');
    await user.clear(screen.getByLabelText('Quantity'));
    await user.type(screen.getByLabelText('Quantity'), '5');
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('New listing', 'a description', 5));
  });

  it('a lapsed trial (402 → LOCKED) shows the Locked card but keeps the add form usable', async () => {
    const api: InventoryApi = { list: vi.fn().mockResolvedValue(LOCKED), create: vi.fn(), edit: vi.fn() };
    render(<Inventory api={api} onSubscribe={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /subscribe/i })).toBeInTheDocument());
    expect(screen.getByLabelText('Item title')).toBeInTheDocument(); // create stays available
  });
});
