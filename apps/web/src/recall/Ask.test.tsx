import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ask, type RecallApi } from './Ask.js';
import type { RecallAnswer } from './recallClient.js';

const api = (answer: RecallAnswer | null): RecallApi => ({ ask: vi.fn().mockResolvedValue(answer) });

describe('<Ask>', () => {
  it('asks and renders the answer with its receipts', async () => {
    const user = userEvent.setup();
    const a = api({ answer: 'Ahmed felt pricing was too high.', receipts: [{ quote: 'pricing is too high', date: '2026-01-16', clientId: 'c1', noteId: 'n1' }] });
    render(<Ask api={a} />);
    await user.type(screen.getByLabelText(/your question/i), 'What did Ahmed say?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(await screen.findByTestId('answer')).toHaveTextContent(/pricing was too high/i);
    expect(screen.getByTestId('receipt')).toHaveTextContent(/pricing is too high/i);
    expect(a.ask).toHaveBeenCalledWith('What did Ahmed say?');
  });

  // TRUST RULE: an honest "I don't have that" renders with no receipts.
  it('renders the honest no-answer with no receipts', async () => {
    const user = userEvent.setup();
    render(<Ask api={api({ answer: "I don't have that on record.", receipts: [] })} />);
    await user.type(screen.getByLabelText(/your question/i), 'about Mars?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(await screen.findByTestId('answer')).toHaveTextContent(/don't have that on record/i);
    expect(screen.queryByTestId('receipt')).toBeNull();
  });

  it('keeps Ask disabled until there is a question', () => {
    render(<Ask api={api(null)} />);
    expect(screen.getByRole('button', { name: /^ask$/i })).toBeDisabled();
  });

  // NEGATIVE: a failed request shows an error, not a fabricated answer.
  it('shows an error when the request fails', async () => {
    const user = userEvent.setup();
    render(<Ask api={api(null)} />);
    await user.type(screen.getByLabelText(/your question/i), 'x?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('answer')).toBeNull();
  });

  // Voice: the listen handler fills the box (answered the same as text after).
  it('fills the question from voice when a listen handler is provided', async () => {
    const user = userEvent.setup();
    const listen = vi.fn().mockResolvedValue('what did Sara promise?');
    render(<Ask api={api({ answer: 'x', receipts: [] })} listen={listen} />);
    await user.click(screen.getByRole('button', { name: /ask by voice/i }));
    await waitFor(() => expect(screen.getByLabelText(/your question/i)).toHaveValue('what did Sara promise?'));
  });

  it('shows no voice button when no listen handler is provided', () => {
    render(<Ask api={api(null)} />);
    expect(screen.queryByRole('button', { name: /ask by voice/i })).toBeNull();
  });
});
