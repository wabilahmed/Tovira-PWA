import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DisclosureLine, DISCLOSURE_LINE } from './DisclosureLine.js';

// [PRIVACY-6] The suggested disclosure line: renders, copies, and its wording comes from ONE constant
// (so the owner changes it in a single place). No tracking of whether the rep used it.
describe('DisclosureLine', () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('renders the disclosure wording from the single constant', () => {
    render(<DisclosureLine />);
    expect(screen.getByTestId('disclosure-text').textContent).toBe(DISCLOSURE_LINE);
  });

  it('copies the exact constant to the clipboard', async () => {
    render(<DisclosureLine />);
    fireEvent.click(screen.getByRole('button', { name: /copy the disclosure line/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(DISCLOSURE_LINE));
    expect(await screen.findByRole('button', { name: /copy the disclosure line/i })).toHaveTextContent(/copied/i);
  });
});
