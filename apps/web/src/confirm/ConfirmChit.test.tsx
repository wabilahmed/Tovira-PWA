import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmChit } from './ConfirmChit.js';

describe('<ConfirmChit> (§6 confirmation queue — a guess never reads as a fact)', () => {
  it('shows the guess with a "worth checking" label and Confirm / Not right actions', async () => {
    render(<ConfirmChit text="Confirm the 40/60 payment plan in writing" onConfirm={() => {}} onReject={() => {}} />);
    expect(screen.getByText(/confirm the 40\/60 payment plan/i)).toBeInTheDocument();
    expect(screen.getByText(/worth checking/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^confirm$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /not right/i })).toBeInTheDocument();
  });

  it('calls onConfirm and onReject on the respective actions', async () => {
    const onConfirm = vi.fn();
    const onReject = vi.fn();
    render(<ConfirmChit text="A guess" onConfirm={onConfirm} onReject={onReject} />);
    await userEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    await userEvent.click(screen.getByRole('button', { name: /not right/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  // Neither reply is claret — rejecting a guess is not destructive (board §6).
  it('renders both replies as quiet outlines, not a claret/destructive button', () => {
    render(<ConfirmChit text="A guess" onConfirm={() => {}} onReject={() => {}} />);
    for (const name of [/^confirm$/i, /not right/i]) {
      const btn = screen.getByRole('button', { name });
      expect(btn.className).toMatch(/tov-chit-action/);
      expect(btn.className).not.toMatch(/claret|primary|deal/);
    }
  });

  // An AED value is still a guess → mono, grouped thousands, no symbol art.
  it('renders an optional AED value as a mono grouped-thousands stamp', () => {
    render(<ConfirmChit text="40/60 plan" aed={12000} onConfirm={() => {}} onReject={() => {}} />);
    const val = screen.getByText(/AED\s+12,000/);
    expect(val).toBeInTheDocument();
    expect(val.className).toMatch(/tov-mono/);
  });

  // The chit is one component everywhere: an Arabic guess renders RTL.
  it('renders an Arabic guess right-to-left', () => {
    render(<ConfirmChit text="تأكيد خطة الدفع ٤٠/٦٠" onConfirm={() => {}} onReject={() => {}} />);
    const quote = screen.getByTestId('confirm-chit-text');
    expect(quote).toHaveAttribute('dir', 'rtl');
    expect(quote).toHaveAttribute('lang', 'ar');
  });

  // Confirmed → the tick turns brass (a fact now), not amber.
  it('marks the tick brass once confirmed', () => {
    const { rerender } = render(<ConfirmChit text="A guess" onConfirm={() => {}} onReject={() => {}} />);
    expect(screen.getByTestId('confirm-chit-tick')).toHaveAttribute('data-confirmed', 'false');
    rerender(<ConfirmChit text="A guess" confirmed onConfirm={() => {}} onReject={() => {}} />);
    expect(screen.getByTestId('confirm-chit-tick')).toHaveAttribute('data-confirmed', 'true');
  });
});
