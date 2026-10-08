import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoveSuggestions, type MoveSuggestApi } from './MoveSuggestions.js';
import type { MoveSuggestion, MoveResult } from './noteMoveClient.js';

const clients = [{ id: 'c1', name: 'Acme' }, { id: 'c2', name: 'Meridian' }];
const suggestion: MoveSuggestion = { noteId: 'n1', fromClientId: 'c1', toClientId: 'c2', toClientName: 'Meridian', mentioned: ['Meridian'], reason: 'mentions Meridian' };
const okResult: MoveResult = { ok: true, counts: { messages: 3, promises: 1, keyDates: 0, meetings: 1, people: 1, requirements: 0 } };

function makeApi(over: Partial<MoveSuggestApi> = {}): MoveSuggestApi {
  return {
    listMoveSuggestions: vi.fn().mockResolvedValue([suggestion]),
    move: vi.fn().mockResolvedValue(okResult),
    undo: vi.fn().mockResolvedValue(okResult),
    ...over,
  };
}

describe('<MoveSuggestions>', () => {
  it('renders nothing when there are no suggestions', async () => {
    const { container } = render(<MoveSuggestions api={makeApi({ listMoveSuggestions: vi.fn().mockResolvedValue([]) })} clients={clients} />);
    await waitFor(() => expect((makeApi().listMoveSuggestions as unknown)).toBeDefined());
    expect(container.querySelector('[data-testid="move-suggestion"]')).toBeNull();
  });

  it('shows "Filed under X: move it?" with the current and suggested client', async () => {
    render(<MoveSuggestions api={makeApi()} clients={clients} />);
    const card = await screen.findByTestId('move-suggestion');
    expect(card).toHaveTextContent(/filed under acme/i);
    expect(card).toHaveTextContent(/meridian/i);
    expect(screen.getByRole('button', { name: /^Move$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Keep$/i })).toBeInTheDocument();
  });

  it('Move calls move(noteId, toClientId), drops the prompt, and offers Undo', async () => {
    const move = vi.fn().mockResolvedValue(okResult);
    render(<MoveSuggestions api={makeApi({ move })} clients={clients} />);
    await screen.findByTestId('move-suggestion');
    await userEvent.click(screen.getByRole('button', { name: /^Move$/i }));
    await waitFor(() => expect(move).toHaveBeenCalledWith('n1', 'c2'));
    await waitFor(() => expect(screen.queryByTestId('move-suggestion')).toBeNull());
    expect(await screen.findByRole('button', { name: /^Undo$/i })).toBeInTheDocument();
    expect(screen.getByTestId('move-toast')).toHaveTextContent(/moved to meridian/i);
  });

  it('Undo reverses the move — move(noteId, originalClientId), NOT a delete', async () => {
    const undo = vi.fn().mockResolvedValue(okResult);
    render(<MoveSuggestions api={makeApi({ undo })} clients={clients} />);
    await screen.findByTestId('move-suggestion');
    await userEvent.click(screen.getByRole('button', { name: /^Move$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^Undo$/i }));
    await waitFor(() => expect(undo).toHaveBeenCalledWith('n1', 'c1'));
    await waitFor(() => expect(screen.queryByTestId('move-toast')).toBeNull());
  });

  it('Keep dismisses the prompt without moving anything', async () => {
    const move = vi.fn();
    render(<MoveSuggestions api={makeApi({ move })} clients={clients} />);
    await screen.findByTestId('move-suggestion');
    await userEvent.click(screen.getByRole('button', { name: /^Keep$/i }));
    await waitFor(() => expect(screen.queryByTestId('move-suggestion')).toBeNull());
    expect(move).not.toHaveBeenCalled();
  });
});
