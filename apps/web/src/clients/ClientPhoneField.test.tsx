import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClientPhoneField } from './ClientPhoneField.js';

describe('<ClientPhoneField> (P4-7)', () => {
  it('shows the current phone and saves an edit', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ClientPhoneField phone="+971501234567" onSave={onSave} />);
    const input = screen.getByLabelText(/phone/i);
    expect(input).toHaveValue('+971501234567');
    await user.clear(input);
    await user.type(input, '+971509999999');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('+971509999999'));
  });

  it('starts empty when there is no phone yet', () => {
    render(<ClientPhoneField phone={null} onSave={vi.fn()} />);
    expect(screen.getByLabelText(/phone/i)).toHaveValue('');
  });

  it('confirms after a successful save', async () => {
    const user = userEvent.setup();
    render(<ClientPhoneField phone={null} onSave={vi.fn().mockResolvedValue(undefined)} />);
    await user.type(screen.getByLabelText(/phone/i), '+971501234567');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
  });
});
