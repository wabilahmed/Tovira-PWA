import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './ThemeToggle.js';

// [P46-2] Owner (phone review): "Ledger / Vault / System" read as product names. The choices are Light / Dark / Auto;
// the stored theme ids stay ledger / vault / system.
describe('[P46-2] Appearance', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });

  it('offers Light / Dark / Auto; NEGATIVE: never Ledger / Vault / System as a label', () => {
    const { container } = render(<ThemeToggle />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Light', 'Dark', 'Auto']);
    expect(container.textContent).not.toMatch(/Ledger|Vault|System/);
  });

  it('Dark stores the same id as before ("vault")', async () => {
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme ?? localStorage.getItem('tovira.theme')).toMatch(/vault|dark/);
    expect(localStorage.getItem('tovira.theme')).toBe('vault');
  });
});
