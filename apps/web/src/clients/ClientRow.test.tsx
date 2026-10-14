import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClientRow } from './ClientRow.js';
import type { ClientSummary } from './clientsClient.js';

const c: ClientSummary = { id: 'c1', name: 'Ahmed Khan', phone: '+971 50 123 4567', email: 'a@emaar.ae', createdAt: Date.parse('2026-08-01T00:00:00Z'), leadStatus: 'warm' };

describe('<ClientRow>', () => {
  it('[UI-04] the open button has an accessible name "Open {client name}"', () => {
    render(<ul><ClientRow client={c} onOpen={() => {}} onOpenStatus={() => {}} /></ul>);
    expect(screen.getByRole('button', { name: 'Open Ahmed Khan' })).toBeInTheDocument();
  });

  it('opens the book and the status sheet via their own handlers (pill does not open the book)', async () => {
    const onOpen = vi.fn();
    const onOpenStatus = vi.fn();
    render(<ul><ClientRow client={c} onOpen={onOpen} onOpenStatus={onOpenStatus} /></ul>);
    await userEvent.click(screen.getByRole('button', { name: 'Open Ahmed Khan' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByText('Warm')); // the pill
    expect(onOpenStatus).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1); // pill click did NOT also open the book
  });

  it('shows the matched phone field with a highlight when searching', () => {
    render(<ul><ClientRow client={c} onOpen={() => {}} onOpenStatus={() => {}} match={{ field: 'phone', value: '+971 50 123 4567', ranges: [{ start: 12, end: 16 }] }} /></ul>);
    const line = screen.getByTestId('match-phone');
    expect(line).toHaveTextContent('phone: +971 50 123 4567');
    expect(line.querySelector('mark')!.textContent).toBe('4567');
  });
});
