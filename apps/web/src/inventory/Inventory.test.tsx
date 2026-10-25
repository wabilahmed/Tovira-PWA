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

const makeApi = (over: Partial<InventoryApi> = {}): InventoryApi => ({
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  edit: vi.fn(),
  share: vi.fn(),
  sharesForItem: vi.fn().mockResolvedValue([]),
  setOutcome: vi.fn(),
  ...over,
});

describe('<Inventory>', () => {
  it('lists active items with their quantity', async () => {
    render(<Inventory api={makeApi({ list: vi.fn().mockResolvedValue([item({})]) })} onSubscribe={vi.fn()} />);
    expect(await screen.findByText('Marina 402')).toBeInTheDocument();
    // [P43 · owner] the field is labelled "Quantity (optional)" now
    expect(screen.getByLabelText('Quantity (optional)')).toBeTruthy();
  });

  it('a disabled item shows its status stamp and a "Set quantity" action', async () => {
    const api = makeApi({ list: vi.fn().mockImplementation((s?: string) => Promise.resolve(s === 'disabled' ? [item({ id: 'd1', title: 'Sold villa', status: 'disabled', disabledReason: 'sold_out', quantity: 0 })] : [])) });
    const user = userEvent.setup();
    render(<Inventory api={api} onSubscribe={vi.fn()} />);
    await user.click(await screen.findByRole('tab', { name: 'Disabled' }));
    expect(await screen.findByText('OUT OF STOCK')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set quantity' })).toBeInTheDocument();
  });

  it('adding an item calls create with the entered fields', async () => {
    const api = makeApi({ create: vi.fn().mockResolvedValue(item({})) });
    const user = userEvent.setup();
    render(<Inventory api={api} onSubscribe={vi.fn()} />);
    await user.type(screen.getByLabelText('Item title'), 'New listing');
    await user.type(screen.getByLabelText('Item description'), 'a description');
    // [P43 · owner] labelled "Quantity (optional)"; a typed quantity is still sent
    await user.clear(screen.getByLabelText('Quantity (optional)'));
    await user.type(screen.getByLabelText('Quantity (optional)'), '5');
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('New listing', 'a description', 5));
  });

  it('sharing an item: pick a client, record the share, open a WhatsApp draft (Tovira never sends)', async () => {
    const share = vi.fn().mockResolvedValue({ share: { id: 's1' }, warning: null });
    const api = makeApi({ list: vi.fn().mockResolvedValue([item({})]), share });
    const openLink = vi.fn();
    const user = userEvent.setup();
    render(<Inventory api={api} clients={[{ id: 'c1', name: 'Ahmed', phone: '+971501234567' }]} onSubscribe={vi.fn()} openLink={openLink} />);
    await user.click(await screen.findByRole('button', { name: 'Share' }));
    await user.click(screen.getByRole('button', { name: /send via whatsapp/i }));
    await waitFor(() => expect(share).toHaveBeenCalledWith('i1', 'c1'));
    expect(openLink).toHaveBeenCalledWith(expect.stringContaining('wa.me/971501234567'));
  });

  it('a duplicate-share warning is shown when the API flags prior pending shares', async () => {
    const share = vi.fn().mockResolvedValue({ share: { id: 's2' }, warning: [{ id: 'p1', clientId: 'c1', sharedAt: Date.now(), itemId: 'i1', outcome: 'pending', outcomeSetBy: 'rep', quantityBought: null }] });
    const api = makeApi({ list: vi.fn().mockResolvedValue([item({ quantity: 1 })]), share });
    const user = userEvent.setup();
    render(<Inventory api={api} clients={[{ id: 'c1', name: 'Meridian', phone: null }]} onSubscribe={vi.fn()} openLink={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Share' }));
    await user.click(screen.getByRole('button', { name: /send via whatsapp/i }));
    expect(await screen.findByText(/already shared with Meridian/i)).toBeInTheDocument();
  });

  it('shows an item\'s share history and lets the rep mark a pending share bought', async () => {
    const share = { id: 'sh1', itemId: 'i1', clientId: 'c1', sharedAt: Date.now(), outcome: 'pending' as const, outcomeSetBy: 'rep' as const, quantityBought: null };
    const setOutcome = vi.fn().mockResolvedValue({ ...share, outcome: 'bought' });
    const api = makeApi({ list: vi.fn().mockResolvedValue([item({})]), sharesForItem: vi.fn().mockResolvedValue([share]), setOutcome });
    const user = userEvent.setup();
    render(<Inventory api={api} clients={[{ id: 'c1', name: 'Ahmed', phone: null }]} onSubscribe={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'History' }));
    expect(await screen.findByText('Ahmed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bought' }));
    await waitFor(() => expect(setOutcome).toHaveBeenCalledWith('sh1', 'bought'));
  });

  it('a lapsed trial (402 → LOCKED) shows the Locked card but keeps the add form usable', async () => {
    render(<Inventory api={makeApi({ list: vi.fn().mockResolvedValue(LOCKED) })} onSubscribe={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('subscribe-annual')).toBeInTheDocument()); // Locked card's plan buttons
    expect(screen.getByLabelText('Item title')).toBeInTheDocument();
  });
});

// [P42-B3] Owner: the example title fits any rep's offering, not a property unit.
describe('[P42-B3] the add-item placeholder is neutral', () => {
  it('reads "Title (e.g. Premium plan, Unit 402, Q3 proposal)"', async () => {
    render(<Inventory api={makeApi({ list: vi.fn().mockResolvedValue([]) })} onSubscribe={vi.fn()} />);
    expect(await screen.findByLabelText('Item title')).toHaveAttribute('placeholder', 'Title (e.g. Premium plan, Unit 402, Q3 proposal)');
  });
  it('NEGATIVE: no building name in the example', async () => {
    render(<Inventory api={makeApi({ list: vi.fn().mockResolvedValue([]) })} onSubscribe={vi.fn()} />);
    expect((await screen.findByLabelText('Item title')).getAttribute('placeholder')).not.toMatch(/Marina|Heights/);
  });
});

// [P43-4] Owner: quantity is optional and hidden when blank; "Out of stock" only when a quantity is set and it is 0.
describe('[P43-4] optional quantity', () => {
  it('an item with no quantity shows no number and no stock label', async () => {
    render(<Inventory api={makeApi({ list: vi.fn().mockResolvedValue([item({ id: 'p', title: 'Premium plan', quantity: null })]) })} onSubscribe={vi.fn()} />);
    const card = (await screen.findByText('Premium plan')).closest('li')!;
    expect(card.querySelector('.tov-inv-item__qty')).toBeNull();
    expect(card.textContent).not.toMatch(/out of stock/i);
  });

  it('"Out of stock" shows when a quantity is set and it is 0', async () => {
    render(<Inventory api={makeApi({ list: vi.fn().mockResolvedValue([item({ title: 'Unit 402', quantity: 0, status: 'disabled', disabledReason: 'sold_out' })]) })} onSubscribe={vi.fn()} />);
    const card = (await screen.findByText('Unit 402')).closest('li')!;
    expect(card.textContent).toMatch(/OUT OF STOCK/);
  });

  it('NEGATIVE: never "Out of stock" without a quantity of 0', async () => {
    render(<Inventory api={makeApi({ list: vi.fn().mockResolvedValue([item({ title: 'Q3 proposal', quantity: null, status: 'disabled', disabledReason: 'sold_out' })]) })} onSubscribe={vi.fn()} />);
    const card = (await screen.findByText('Q3 proposal')).closest('li')!;
    expect(card.textContent).not.toMatch(/out of stock/i);
  });

  it('the add form starts blank and sends no quantity when it is left blank', async () => {
    const create = vi.fn().mockResolvedValue(item({ quantity: null }));
    render(<Inventory api={makeApi({ create })} onSubscribe={vi.fn()} />);
    expect(await screen.findByLabelText('Quantity (optional)')).toHaveValue(null);
    await userEvent.type(screen.getByLabelText('Item title'), 'Premium plan');
    await userEvent.type(screen.getByLabelText('Item description'), 'motor and medical');
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('Premium plan', 'motor and medical', null));
  });
});
