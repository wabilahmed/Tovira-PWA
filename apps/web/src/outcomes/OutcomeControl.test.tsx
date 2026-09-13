import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OutcomeControl } from './OutcomeControl.js';

// [OUTCOME-3] One reusable control: won / lost / still open. Accessible by LABEL, never colour or
// icon alone. Reversible. It reports the rep's choice; the surface persists it.
describe('OutcomeControl', () => {
  it('offers won, lost and still-open, each with a text label (not colour/icon alone)', () => {
    render(<OutcomeControl clientName="Acme" onChoose={() => {}} />);
    expect(screen.getByRole('button', { name: /mark acme won/i })).toHaveTextContent(/won/i);
    expect(screen.getByRole('button', { name: /mark acme lost/i })).toHaveTextContent(/lost/i);
    expect(screen.getByRole('button', { name: /acme still open/i })).toHaveTextContent(/still open/i);
  });

  it('is labelled as a group for the client', () => {
    render(<OutcomeControl clientName="Acme" onChoose={() => {}} />);
    expect(screen.getByRole('group', { name: /outcome for acme/i })).toBeInTheDocument();
  });

  it('reports the chosen outcome', async () => {
    const onChoose = vi.fn();
    render(<OutcomeControl clientName="Acme" onChoose={onChoose} />);
    fireEvent.click(screen.getByRole('button', { name: /mark acme lost/i }));
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith('lost'));
  });

  it('reflects a current outcome as the pressed choice (a lost_inferred reads as Lost)', () => {
    render(<OutcomeControl clientName="Acme" current="lost_inferred" onChoose={() => {}} />);
    expect(screen.getByRole('button', { name: /mark acme lost/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /mark acme won/i })).toHaveAttribute('aria-pressed', 'false');
  });
});
