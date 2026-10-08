import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotFound } from './NotFound.js';

afterEach(() => vi.restoreAllMocks());

describe('[AUDIT item 2] <NotFound>', () => {
  it('shows "Page not found" and a Back to Today button that navigates home', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const user = userEvent.setup();
    render(<NotFound />);
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back to today/i }));
    expect(assign).toHaveBeenCalledWith('/app?view=today');
    vi.unstubAllGlobals();
  });
});
