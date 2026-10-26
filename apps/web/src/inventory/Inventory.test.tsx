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
    // [P46-1 · owner] the quantity reads "3 left" on the card; the field lives in the "+ Add item" sheet
    expect(screen.getByText('3 left')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+ Add item' }));
    expect(screen.getByLabelText('Quantity (optional)')).toBeTruthy();
  });

  // [P46-1 · owner] Disabled → "Paused", "OUT OF STOCK" → a "Sold out" badge, and the quantity is set through Edit.
  it('a disabled item shows its status stamp and a "Set quantity" action', async () => {
    const api = makeApi({ list: vi.fn().mockImplementation((s?: string) => Promise.resolve(s === 'disabled' ? [item({ id: 'd1', title: 'Sold villa', status: 'disabled', disabledReason: 'sold_out', quantity: 0 })] : [])) });
    const user = userEvent.setup();
    render(<Inventory api={api} onSubscribe={vi.fn()} />);
    await user.click(await screen.findByRole('tab', { name: 'Paused' }));
    expect(await screen.findByText('Sold out')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Quantity (optional)')).toHaveValue(0);
  });

  it('adding an item calls create with the entered fields', async () => {
    const api = makeApi({ create: vi.fn().mockResolvedValue(item({})) });
    const user = userEvent.setup();
    render(<Inventory api={api} onSubscribe={vi.fn()} />);
    // [P46-1 · owner] the form opens from "+ Add item"; fields are "Title" and "Description"
    await user.click(screen.getByRole('button', { name: '+ Add item' }));
    await user.type(screen.getByLabelText('Title'), 'New listing');
    await user.type(screen.getByLabelText('Description'), 'a description');
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
    // [P46-1 · owner] the add form is the "+ Add item" sheet
    await userEvent.click(screen.getByRole('button', { name: '+ Add item' }));
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
  });
});

// [P42-B3] Owner: the example title fits any rep's offering, not a property unit.
describe('[P42-B3] the add-item placeholder is neutral', () => {
  // [P46-1 · owner] shortened to fit at 390px: "e.g. Premium plan" under the "Title" label, in the add sheet
  it('reads "e.g. Premium plan"', async () => {
    render(<Inventory api={makeApi({ list: vi.fn().mockResolvedValue([]) })} onSubscribe={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add item' }));
    expect(screen.getByLabelText('Title')).toHaveAttribute('placeholder', 'e.g. Premium plan');
  });
  it('NEGATIVE: no building name in the example', async () => {
    render(<Inventory api={makeApi({ list: vi.fn().mockResolvedValue([]) })} onSubscribe={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add item' }));
    expect(screen.getByLabelText('Title').getAttribute('placeholder')).not.toMatch(/Marina|Heights/);
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

  // [P46-1 · owner] "Out of stock" is now the "Sold out" badge
  it('"Out of stock" shows when a quantity is set and it is 0', async () => {
    render(<Inventory api={makeApi({ list: vi.fn().mockResolvedValue([item({ title: 'Unit 402', quantity: 0, status: 'disabled', disabledReason: 'sold_out' })]) })} onSubscribe={vi.fn()} />);
    const card = (await screen.findByText('Unit 402')).closest('li')!;
    expect(card.textContent).toMatch(/Sold out/);
  });

  // [P46-1 · owner] and never "Sold out" either
  it('NEGATIVE: never "Out of stock" without a quantity of 0', async () => {
    render(<Inventory api={makeApi({ list: vi.fn().mockResolvedValue([item({ title: 'Q3 proposal', quantity: null, status: 'disabled', disabledReason: 'sold_out' })]) })} onSubscribe={vi.fn()} />);
    const card = (await screen.findByText('Q3 proposal')).closest('li')!;
    expect(card.textContent).not.toMatch(/out of stock|sold out/i);
  });

  it('the add form starts blank and sends no quantity when it is left blank', async () => {
    const create = vi.fn().mockResolvedValue(item({ quantity: null }));
    render(<Inventory api={makeApi({ create })} onSubscribe={vi.fn()} />);
    // [P46-1 · owner] the add form is the "+ Add item" sheet
    await userEvent.click(await screen.findByRole('button', { name: '+ Add item' }));
    expect(await screen.findByLabelText('Quantity (optional)')).toHaveValue(null);
    await userEvent.type(screen.getByLabelText('Title'), 'Premium plan');
    await userEvent.type(screen.getByLabelText('Description'), 'motor and medical');
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('Premium plan', 'motor and medical', null));
  });
});

// [P46-1] Owner (phone review, 26 Oct): a header with "← More", one "+ Add item" button that opens a sheet, the intro
// without "how many", a card with title then description, the quantity only when set ("3 left"), one row of equal
// buttons (Share · Edit · History), tabs Available / Paused, a Sold out badge, and an empty state that explains.
describe('[P46-1] Inventory', () => {
  const back = { label: 'More', onBack: vi.fn() };
  it('the header: "Inventory", "← More", "What you have to sell"; the intro without "how many"', async () => {
    render(<Inventory api={makeApi()} onSubscribe={vi.fn()} back={back} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Inventory' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to More' })).toHaveTextContent('← More');
    expect(screen.getByText('What you have to sell')).toBeInTheDocument();
    expect(screen.getByText('List what you sell. When a client asks for something similar, Tovira suggests it on their page.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/how many/i);
  });

  it('NEGATIVE: no always-open add form; "+ Add item" opens a sheet with Title, Description and Quantity (optional)', async () => {
    const create = vi.fn().mockResolvedValue(item({ quantity: null }));
    const user = userEvent.setup();
    render(<Inventory api={makeApi({ create })} onSubscribe={vi.fn()} back={back} />);
    await screen.findByRole('button', { name: '+ Add item' });
    expect(screen.queryByLabelText('Title')).toBeNull();
    await user.click(screen.getByRole('button', { name: '+ Add item' }));
    const dialog = await screen.findByRole('dialog');
    expect(screen.getByLabelText('Title')).toHaveAttribute('placeholder', 'e.g. Premium plan');
    expect(screen.getByLabelText('Description')).toHaveAttribute('placeholder', 'What it is, so Tovira can match it');
    expect(screen.getByLabelText('Quantity (optional)')).toHaveValue(null);
    await user.type(screen.getByLabelText('Title'), 'Premium plan');
    await user.type(screen.getByLabelText('Description'), 'motor and medical');
    await user.click(dialog.querySelector('button[type=submit]')!);
    await waitFor(() => expect(create).toHaveBeenCalledWith('Premium plan', 'motor and medical', null));
  });

  it('a card: title, then description; "3 left" only when a quantity is set', async () => {
    render(<Inventory api={makeApi({ list: vi.fn().mockResolvedValue([item({ id: 'a', title: 'Premium plan', description: 'motor', quantity: 3 }), item({ id: 'b', title: 'Q3 proposal', description: 'retainer', quantity: null })]) })} onSubscribe={vi.fn()} />);
    const a = (await screen.findByText('Premium plan')).closest('li')!;
    expect(a.textContent).toMatch(/Premium plan.*motor.*3 left/);
    const b = screen.getByText('Q3 proposal').closest('li')!;
    expect(b.textContent).not.toMatch(/left/);
  });

  it('one action row of equal buttons: Share · Edit · History, none primary', async () => {
    render(<Inventory api={makeApi({ list: vi.fn().mockResolvedValue([item({})]) })} clients={[{ id: 'c1', name: 'Ahmed', phone: null }]} onSubscribe={vi.fn()} />);
    const card = (await screen.findByText('Marina 402')).closest('li')!;
    const row = card.querySelector('[data-testid=item-actions]')!;
    const buttons = [...row.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Share', 'Edit', 'History']);
    expect(new Set(buttons.map((b) => b.className)).size).toBe(1);
    expect(row.querySelector('.ui-btn--primary')).toBeNull();
  });

  it('tabs are Available / Paused; NEGATIVE: never "Active" / "Disabled"', async () => {
    render(<Inventory api={makeApi()} onSubscribe={vi.fn()} />);
    expect(await screen.findByRole('tab', { name: 'Available' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Paused' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /active|disabled/i })).toBeNull();
  });

  it('a sold-out item (quantity 0) shows a "Sold out" badge', async () => {
    render(<Inventory api={makeApi({ list: vi.fn().mockResolvedValue([item({ title: 'Unit 402', quantity: 0, status: 'disabled', disabledReason: 'sold_out' })]) })} onSubscribe={vi.fn()} />);
    const card = (await screen.findByText('Unit 402')).closest('li')!;
    expect(card.querySelector('.ui-badge')?.textContent).toBe('Sold out');
  });

  it('the empty state explains matching and sharing, one line each', async () => {
    render(<Inventory api={makeApi()} onSubscribe={vi.fn()} />);
    const empty = await screen.findByTestId('inventory-empty');
    expect(empty.textContent).toMatch(/suggests/i);
    expect(empty.textContent).toMatch(/WhatsApp/);
  });
});
