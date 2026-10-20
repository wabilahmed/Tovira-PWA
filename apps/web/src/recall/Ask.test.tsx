import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ask, type RecallApi } from './Ask.js';
import type { RecallAnswer } from './recallClient.js';

const api = (answer: RecallAnswer | null): RecallApi => ({ ask: vi.fn().mockResolvedValue(answer) });

describe('[AUDIT gap C / item 5] <Ask> paused state shows the right action per reason', () => {
  async function askPaused(pausedReason?: string): Promise<string> {
    const user = userEvent.setup();
    render(<Ask api={api({ answer: '', receipts: [], paused: true, pausedReason })} />);
    await user.type(screen.getByLabelText('Your question'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    const msg = await screen.findByRole('alert');
    expect(msg).not.toHaveTextContent(/something went wrong/i); // never the generic error
    return msg.textContent ?? '';
  }

  it('allowance exhausted → top up', async () => {
    expect(await askPaused('allowance_exhausted')).toMatch(/allowance.*top up/i);
  });
  it('payment failed → update card', async () => {
    expect(await askPaused('ai_paused')).toMatch(/payment failed.*update your card/i);
  });
  it('trial/plan ended → subscribe', async () => {
    expect(await askPaused('payment_required')).toMatch(/subscribe in billing/i);
  });
});

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

/** [P35-2] A not-found answer shows no "Receipts" section and no "On record" label; near-misses sit behind a
 *  collapsed "Closest messages I found". */
describe('[P35-2] <Ask> not-found answer', () => {
  const NOT_FOUND = "I don't have that on record.";
  async function ask(result: RecallAnswer) {
    const user = userEvent.setup();
    render(<Ask api={api(result)} />);
    await user.type(screen.getByLabelText('Your question'), 'How many clients do I have with open requirements?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByTestId('answer');
    return user;
  }
  it('no Receipts heading, no On record label; near-misses collapsed behind "Closest messages I found"', async () => {
    const user = await ask({ answer: NOT_FOUND, receipts: [], nearMisses: [{ quote: 'Gate client chat', date: '2026-05-04', clientId: 'c1', noteId: 'n1' }] });
    expect(screen.queryByText('Receipts')).toBeNull();
    expect(screen.queryByText(/on record$/i)).toBeNull();
    expect(screen.queryByText(/Gate client chat/)).toBeNull(); // collapsed
    await user.click(screen.getByText('Closest messages I found'));
    expect(await screen.findByText(/Gate client chat/)).toBeInTheDocument();
  });
  it('even an older server that sends receipts with a not-found answer shows no Receipts section', async () => {
    await ask({ answer: NOT_FOUND, receipts: [{ quote: 'Gate client chat', date: '2026-05-04', clientId: 'c1', noteId: 'n1' }] });
    expect(screen.queryByText('Receipts')).toBeNull();
    expect(screen.queryByText(/on record$/i)).toBeNull();
  });
});

/** [P35-1] A count / list answer: the count first (bold), then one line per client, each with its own receipt. */
describe('[P35-1] <Ask> count & list answers', () => {
  it('"3 clients have open requirements:" with the count bold and one receipted line per client, then "…and N more"', async () => {
    const user = userEvent.setup();
    const item = (id: string, name: string, line: string, quote: string) => ({ clientId: id, clientName: name, line, receipts: [{ quote, date: '2026-04-12', clientId: id, noteId: `n-${id}` }] });
    render(<Ask api={api({
      answer: '3 clients have open requirements:\n• …',
      receipts: [],
      list: {
        count: 13, headline: '13 clients have open requirements:', more: 10,
        items: [
          item('c1', 'QA P14 Gate Client', '2BR in JVC, budget around 1.5M, parking for two cars', 'looking for a 2BR in JVC'),
          item('c2', 'QA Windowed Buyer 2', '4BR villa in Mirdif, Updated budget of 3.4M', 'looking for a 4BR villa in Mirdif, budget around 3M'),
          item('c3', 'QA Enter Key Client', '3BR townhouse in Arabian Ranches, budget 2.2M', 'A 3BR townhouse in Arabian Ranches, budget 2.2M'),
        ],
      },
    })} />);
    await user.type(screen.getByLabelText('Your question'), 'How many clients do I have with open requirements?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    const answer = await screen.findByTestId('answer');
    expect(answer).toHaveTextContent('13 clients have open requirements:');
    expect(screen.getByText('13 clients').tagName).toBe('STRONG');
    const lines = screen.getAllByTestId('list-line');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveTextContent('QA P14 Gate Client: 2BR in JVC, budget around 1.5M, parking for two cars');
    for (const l of lines) expect(l.querySelector('[data-testid="receipt"], .tov-receipt, [data-testid="receipt-thread"]')).not.toBeNull();
    expect(screen.getByText('…and 10 more.')).toBeInTheDocument();
    expect(screen.queryByText('Receipts')).toBeNull(); // each line carries its own
  });
});
