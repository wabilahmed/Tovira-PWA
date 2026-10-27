import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClientNameMenu, type RenameApi } from './ClientNameMenu.js';
import type { ClientSummary } from '../clientsClient.js';

// [P49-5] Owner: on the client page header, a ⋯ menu → "Edit name" opens a Sheet with one field, prefilled, and Save.
// Trimmed, never empty, at most 80 characters; another client with that exact name is a warning ("You already have a
// client called X. Save anyway?"), never a merge; "Saved" is a Toast with Undo for 5 seconds; a client under an active
// erasure restriction has no "Edit name".
const client = (name: string): ClientSummary => ({ id: 'c1', name, phone: null, createdAt: 0 });
function api(over: Partial<RenameApi> = {}): RenameApi & { rename: ReturnType<typeof vi.fn> } {
  return { rename: vi.fn(async (_id: string, name: string) => ({ ok: true as const, client: client(name), previousName: 'Khalid Dubai Marina' })), ...over } as RenameApi & { rename: ReturnType<typeof vi.fn> };
}
const openSheet = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  await user.click(screen.getByRole('menuitem', { name: 'Edit name' }));
};
afterEach(() => vi.useRealTimers());

describe('[P49-5] Edit name', () => {
  it('⋯ → Edit name opens a sheet with the name prefilled; Save renames, trimmed, and reports the new client', async () => {
    const user = userEvent.setup();
    const a = api(); const onRenamed = vi.fn();
    render(<ClientNameMenu client={client('Khalid Dubai Marina')} api={a} onRenamed={onRenamed} />);
    await openSheet(user);
    const field = screen.getByLabelText('Client name');
    expect(field).toHaveValue('Khalid Dubai Marina');
    await user.clear(field);
    await user.type(field, '  Khalid Al Mansoori  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(a.rename).toHaveBeenCalledWith('c1', 'Khalid Al Mansoori', false));
    expect(onRenamed).toHaveBeenCalledWith(expect.objectContaining({ name: 'Khalid Al Mansoori' }));
    const toast = await screen.findByText('Saved');
    expect(toast.closest('.ui-toast')).not.toBeNull();
    expect(screen.queryByLabelText('Client name')).toBeNull(); // the sheet closed
  });

  it('NEGATIVE: an empty name is refused in the sheet; nothing is sent', async () => {
    const user = userEvent.setup();
    const a = api();
    render(<ClientNameMenu client={client('Khalid')} api={a} onRenamed={vi.fn()} />);
    await openSheet(user);
    await user.clear(screen.getByLabelText('Client name'));
    await user.type(screen.getByLabelText('Client name'), '   ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A client name is required.')).toBeInTheDocument();
    expect(a.rename).not.toHaveBeenCalled();
  });

  it('NEGATIVE: 81 characters is refused in the sheet; nothing is sent', async () => {
    const user = userEvent.setup();
    const a = api();
    render(<ClientNameMenu client={client('Khalid')} api={a} onRenamed={vi.fn()} />);
    await openSheet(user);
    await user.clear(screen.getByLabelText('Client name'));
    await user.click(screen.getByLabelText('Client name'));
    await user.paste('k'.repeat(81));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Keep the name to 80 characters or fewer.')).toBeInTheDocument();
    expect(a.rename).not.toHaveBeenCalled();
  });

  it('NEGATIVE: a name another client has asks first; "Save anyway" saves it as a separate client', async () => {
    const user = userEvent.setup();
    const a = api({ rename: vi.fn(async (_id: string, name: string, confirm: boolean) => (confirm ? { ok: true as const, client: client(name), previousName: 'Sara K' } : { ok: false as const, reason: 'duplicate' as const, message: 'You already have a client called Sara Khan. Save anyway?' })) });
    const onRenamed = vi.fn();
    render(<ClientNameMenu client={client('Sara K')} api={a} onRenamed={onRenamed} />);
    await openSheet(user);
    await user.clear(screen.getByLabelText('Client name'));
    await user.type(screen.getByLabelText('Client name'), 'Sara Khan');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('You already have a client called Sara Khan. Save anyway?')).toBeInTheDocument();
    expect(onRenamed).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(a.rename).toHaveBeenLastCalledWith('c1', 'Sara Khan', true));
    expect(onRenamed).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sara Khan' }));
  });

  it('Undo in the toast renames back to the old name', async () => {
    const user = userEvent.setup();
    const a = api(); const onRenamed = vi.fn();
    render(<ClientNameMenu client={client('Khalid Dubai Marina')} api={a} onRenamed={onRenamed} />);
    await openSheet(user);
    await user.clear(screen.getByLabelText('Client name'));
    await user.type(screen.getByLabelText('Client name'), 'Khalid Al Mansoori');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(a.rename).toHaveBeenLastCalledWith('c1', 'Khalid Dubai Marina', true));
    expect(onRenamed).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Khalid Dubai Marina' }));
    await waitFor(() => expect(screen.queryByText('Saved')).toBeNull());
  });

  it('the toast and its Undo go after 5 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ClientNameMenu client={client('Khalid')} api={api()} onRenamed={vi.fn()} />);
    await openSheet(user);
    await user.clear(screen.getByLabelText('Client name'));
    await user.type(screen.getByLabelText('Client name'), 'Khalid Al Mansoori');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(4_900); });
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('NEGATIVE: a client under an erasure restriction has no Edit name', () => {
    render(<ClientNameMenu client={{ ...client('Khalid'), nameLocked: true }} api={api()} onRenamed={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.queryByText('Edit name')).toBeNull();
  });

  it('NEGATIVE: a refusal from the server (the restriction began meanwhile) shows its message and changes nothing', async () => {
    const user = userEvent.setup();
    const onRenamed = vi.fn();
    const a = api({ rename: vi.fn(async () => ({ ok: false as const, reason: 'restricted' as const, message: 'This client can\'t be renamed while a privacy request is reviewed.' })) });
    render(<ClientNameMenu client={client('Khalid')} api={a} onRenamed={onRenamed} />);
    await openSheet(user);
    await user.type(screen.getByLabelText('Client name'), ' Two');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This client can\'t be renamed while a privacy request is reviewed.')).toBeInTheDocument();
    expect(onRenamed).not.toHaveBeenCalled();
  });
});
