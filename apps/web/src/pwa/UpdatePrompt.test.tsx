import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdatePrompt } from './UpdatePrompt.js';

describe('<UpdatePrompt>', () => {
  it('shows nothing until a service-worker update is waiting', () => {
    render(<UpdatePrompt />);
    expect(screen.queryByTestId('sw-update-prompt')).toBeNull();
  });

  it('shows "New version available — Reload" on the event, and applies the update only on click', async () => {
    const apply = vi.fn();
    render(<UpdatePrompt />);
    window.dispatchEvent(new CustomEvent('tovira:sw-update', { detail: { apply } }));

    const prompt = await screen.findByTestId('sw-update-prompt');
    expect(prompt).toHaveTextContent(/new version available/i);
    expect(apply).not.toHaveBeenCalled(); // not auto-applied — the rep decides (may be mid-capture)

    await userEvent.click(screen.getByRole('button', { name: /reload/i }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  });
});
