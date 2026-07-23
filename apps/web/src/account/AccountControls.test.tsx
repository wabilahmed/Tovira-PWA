import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountControls, type AccountApi } from './AccountControls.js';

function makeApi(over: Partial<AccountApi> = {}): AccountApi {
  return {
    exportData: vi.fn().mockResolvedValue({ clients: [], notes: [] }),
    deleteAccount: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

describe('<AccountControls>', () => {
  it('exports data and offers a download link', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<AccountControls api={api} onDeleted={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /export my data/i }));
    expect(await screen.findByTestId('download-link')).toHaveAttribute('download', 'tovira-export.json');
    expect(api.exportData).toHaveBeenCalled();
  });

  it('shows an error when export fails', async () => {
    const user = userEvent.setup();
    render(<AccountControls api={makeApi({ exportData: vi.fn().mockResolvedValue(null) })} onDeleted={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /export my data/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  // NEGATIVE: delete requires an explicit confirmation — one click doesn't delete.
  it('does not delete until confirmed; Cancel aborts', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    render(<AccountControls api={api} onDeleted={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /delete my account/i }));
    expect(screen.getByTestId('delete-confirm')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByTestId('delete-confirm')).toBeNull();
    expect(api.deleteAccount).not.toHaveBeenCalled();
  });

  // POSITIVE: confirming deletes and signals the parent (to log out).
  it('deletes on confirmation and calls onDeleted', async () => {
    const user = userEvent.setup();
    const api = makeApi();
    const onDeleted = vi.fn();
    render(<AccountControls api={api} onDeleted={onDeleted} />);
    await user.click(screen.getByRole('button', { name: /delete my account/i }));
    await user.click(screen.getByRole('button', { name: /yes, delete everything/i }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(api.deleteAccount).toHaveBeenCalled();
  });

  it('shows an error when deletion fails', async () => {
    const user = userEvent.setup();
    render(<AccountControls api={makeApi({ deleteAccount: vi.fn().mockResolvedValue(false) })} onDeleted={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /delete my account/i }));
    await user.click(screen.getByRole('button', { name: /yes, delete everything/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
