import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ask, type RecallApi } from './Ask.js';
import type { RecallAnswer } from './recallClient.js';

const api = (answer: RecallAnswer | null): RecallApi => ({ ask: vi.fn().mockResolvedValue(answer) });

describe('[ASK-CAPTURE] <Ask> capture prompt', () => {
  it('shows a confirm prompt with the rep\'s verbatim words for a captured statement, and confirms it', async () => {
    const user = userEvent.setup();
    const confirmCapture = vi.fn().mockResolvedValue(true);
    const answer: RecallAnswer = {
      answer: 'Noted.', receipts: [],
      capture: { status: 'captured', statement: 'Sarah moved to Meridian Capital', clientName: 'Sarah', noteId: 'n1' },
    };
    render(<Ask api={{ ask: vi.fn().mockResolvedValue(answer), confirmCapture, rejectCapture: vi.fn() }} />);
    await user.type(screen.getByLabelText('Your question'), 'about sarah');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByText(/Add to Sarah record\?/i);
    expect(screen.getByText(/Sarah moved to Meridian Capital/)).toBeTruthy(); // verbatim, not a paraphrase
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(confirmCapture).toHaveBeenCalledWith('n1'));
    await screen.findByText(/Added to Sarah record\./i);
  });

  it('[ASK-VOICE] a spoken statement follows the same detect→capture pipeline as a typed one', async () => {
    const user = userEvent.setup();
    const ask = vi.fn().mockResolvedValue({
      answer: 'Noted.', receipts: [],
      capture: { status: 'captured', statement: 'Sarah moved to Meridian Capital', clientName: 'Sarah', noteId: 'n1' },
    } satisfies RecallAnswer);
    const listen = vi.fn().mockResolvedValue('Sarah moved to Meridian Capital'); // the transcript
    render(<Ask api={{ ask, confirmCapture: vi.fn().mockResolvedValue(true), rejectCapture: vi.fn() }} listen={listen} />);
    await user.click(screen.getByRole('button', { name: 'Ask by voice' })); // fills the box from speech
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(ask).toHaveBeenCalledWith('Sarah moved to Meridian Capital'); // the spoken words asked verbatim
    await screen.findByText(/Add to Sarah record\?/i); // same capture prompt — no separate voice path
  });

  it('shows NO capture prompt for an ordinary question (nothing to confirm)', async () => {
    const user = userEvent.setup();
    render(<Ask api={api({ answer: "I don't have that on record.", receipts: [] })} />);
    await user.type(screen.getByLabelText('Your question'), 'did sarah move?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByTestId('answer');
    expect(screen.queryByText(/Add to .* record\?/i)).toBeNull();
  });
});

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
