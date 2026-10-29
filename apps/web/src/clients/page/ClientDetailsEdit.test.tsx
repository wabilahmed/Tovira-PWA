import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClientNameMenu } from './ClientNameMenu.js';

// [P58-P2 · owner] Company and industry are editable in the client's Edit sheet (⋯ → Edit details), beside the name.
// Changing only them saves them and leaves the name alone; changing the name still renames (with its duplicate warning).
const client = { id: 'c1', name: 'Sara Khan', phone: null, createdAt: 1, company: 'Emaar', industry: 'property' };
function setup() {
  const api = {
    rename: vi.fn(async (_id: string, name: string) => ({ ok: true as const, client: { ...client, name }, previousName: 'Sara Khan' })),
    setDetails: vi.fn(async (_id: string, d: { company: string; industry: string }) => ({ ok: true as const, client: { ...client, ...d } })),
  };
  const onRenamed = vi.fn();
  render(<ClientNameMenu client={client} api={api} onRenamed={onRenamed} />);
  return { api, onRenamed, user: userEvent.setup() };
}

describe('[P58-P2] Edit details', () => {
  it('the sheet shows the name, company and industry, prefilled', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit details' }));
    expect(screen.getByRole('heading', { name: 'Edit details' })).toBeInTheDocument();
    expect(screen.getByLabelText('Client name')).toHaveValue('Sara Khan');
    expect(screen.getByLabelText('Company')).toHaveValue('Emaar');
    expect(screen.getByRole('button', { name: 'Industry: Property' })).toBeInTheDocument();
  });
  it('changing only the company saves the details, and does not rename', async () => {
    const { user, api, onRenamed } = setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit details' }));
    await user.clear(screen.getByLabelText('Company'));
    await user.type(screen.getByLabelText('Company'), 'Aldar');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setDetails).toHaveBeenCalledWith('c1', { company: 'Aldar', industry: 'property' }));
    expect(api.rename).not.toHaveBeenCalled();
    expect(onRenamed).toHaveBeenCalledWith(expect.objectContaining({ company: 'Aldar' }));
  });
  it('changing the industry saves it', async () => {
    const { user, api } = setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit details' }));
    await user.click(screen.getByRole('button', { name: 'Industry: Property' }));
    await user.click(screen.getByRole('radio', { name: /^Recruitment/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setDetails).toHaveBeenCalledWith('c1', { company: 'Emaar', industry: 'recruitment' }));
  });
  it('NEGATIVE: changing only the name renames, and does not touch the details', async () => {
    const { user, api } = setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit details' }));
    await user.clear(screen.getByLabelText('Client name'));
    await user.type(screen.getByLabelText('Client name'), 'Sara Al Marri');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.rename).toHaveBeenCalledWith('c1', 'Sara Al Marri', false));
    expect(api.setDetails).not.toHaveBeenCalled();
  });
});
