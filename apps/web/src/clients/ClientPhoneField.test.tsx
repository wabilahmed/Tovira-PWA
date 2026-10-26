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
    // [P46-4 · owner] the stored number is shown in international format
    expect(input).toHaveValue('+971 50 123 4567');
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

// [P46-4] Owner (phone review): "Phon / e", "Sav / e" and "Save / d" wrapped letter by letter. The label sits above a
// full-width field, Save has its own room, "Saved" is a Toast, numbers show in international format, and a refused
// number shows the server's fix.
describe('[P46-4] the phone field', () => {
  it('the label sits above a full-width field (the design-system field), with Save in its own row', () => {
    const { container } = render(<ClientPhoneField phone={null} onSave={vi.fn()} />);
    const field = container.querySelector('.ui-field')!;
    expect(field.querySelector('label.ui-field__label')?.textContent).toBe('Phone');
    expect(field.querySelector('input.ui-input')).not.toBeNull();
    expect(field.contains(screen.getByRole('button', { name: 'Save' }))).toBe(false);
  });

  it('shows "+971 50 386 3103" for a stored "+971503863103"', () => {
    render(<ClientPhoneField phone="+971503863103" onSave={vi.fn()} />);
    expect(screen.getByLabelText('Phone')).toHaveValue('+971 50 386 3103');
  });

  it('"Saved" is a Toast, not inline text', async () => {
    render(<ClientPhoneField phone={null} onSave={vi.fn().mockResolvedValue(undefined)} />);
    await userEvent.type(screen.getByLabelText('Phone'), '+971503863103');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const toast = await screen.findByText('Saved');
    expect(toast.closest('.ui-toast')).not.toBeNull();
  });

  it('NEGATIVE: a refused number shows the server\'s fix and no "Saved"', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Add the country code, for example +971 50 123 4567.'));
    render(<ClientPhoneField phone={null} onSave={onSave} />);
    await userEvent.type(screen.getByLabelText('Phone'), '0503863103');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add the country code, for example +971 50 123 4567.');
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('a stored number without a country code is shown as typed, with the fix', () => {
    render(<ClientPhoneField phone="0503863103" onSave={vi.fn()} />);
    expect(screen.getByLabelText('Phone')).toHaveValue('0503863103');
    expect(screen.getByText('Add the country code, for example +971 50 123 4567.')).toBeInTheDocument();
  });
});
