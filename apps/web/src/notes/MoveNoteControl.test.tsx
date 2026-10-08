import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoveNoteControl, type MoveNoteApi } from './MoveNoteControl.js';
import type { MovePreview, MoveResult } from './noteMoveClient.js';

const clients = [{ id: 'c1', name: 'Acme' }, { id: 'c2', name: 'Meridian' }, { id: 'c3', name: 'Zeta' }];
const preview: MovePreview = { noteId: 'n1', fromClientId: 'c1', counts: { messages: 5, promises: 2, keyDates: 1, meetings: 1, people: 3, requirements: 0 } };
const okResult: MoveResult = { ok: true, counts: preview.counts };

function makeApi(over: Partial<MoveNoteApi> = {}): MoveNoteApi {
  return {
    preview: vi.fn().mockResolvedValue(preview),
    move: vi.fn().mockResolvedValue(okResult),
    undo: vi.fn().mockResolvedValue(okResult),
    ...over,
  };
}

describe('<MoveNoteControl>', () => {
  it('offers "Move to another client" and lists the OTHER clients only', async () => {
    render(<MoveNoteControl api={makeApi()} noteId="n1" fromClientId="c1" clients={clients} />);
    await userEvent.click(screen.getByRole('button', { name: /move to another client/i }));
    const select = await screen.findByLabelText(/move this note to/i);
    // the note's current client (Acme) is not a move target
    expect(select).not.toHaveTextContent(/acme/i);
    expect(select).toHaveTextContent(/meridian/i);
    expect(select).toHaveTextContent(/zeta/i);
  });

  it('previews what the move carries before confirming', async () => {
    const previewFn = vi.fn().mockResolvedValue(preview);
    render(<MoveNoteControl api={makeApi({ preview: previewFn })} noteId="n1" fromClientId="c1" clients={clients} />);
    await userEvent.click(screen.getByRole('button', { name: /move to another client/i }));
    await userEvent.selectOptions(await screen.findByLabelText(/move this note to/i), 'c2');
    await waitFor(() => expect(previewFn).toHaveBeenCalledWith('n1'));
    const p = await screen.findByTestId('move-note-preview');
    expect(p).toHaveTextContent(/5 messages/i);
    expect(p).toHaveTextContent(/2 promises/i);
    expect(p).toHaveTextContent(/meridian/i);
  });

  it('confirming calls move, fires onMoved, and offers Undo (reverse move)', async () => {
    const move = vi.fn().mockResolvedValue(okResult);
    const undo = vi.fn().mockResolvedValue(okResult);
    const onMoved = vi.fn();
    render(<MoveNoteControl api={makeApi({ move, undo })} noteId="n1" fromClientId="c1" clients={clients} onMoved={onMoved} />);
    await userEvent.click(screen.getByRole('button', { name: /move to another client/i }));
    await userEvent.selectOptions(await screen.findByLabelText(/move this note to/i), 'c2');
    await userEvent.click(await screen.findByRole('button', { name: /^Confirm move$/i }));
    await waitFor(() => expect(move).toHaveBeenCalledWith('n1', 'c2'));
    expect(onMoved).toHaveBeenCalledWith('n1');
    // Undo reverses it — back to the original client, never a delete
    await userEvent.click(await screen.findByRole('button', { name: /^Undo$/i }));
    await waitFor(() => expect(undo).toHaveBeenCalledWith('n1', 'c1'));
  });

  it('Cancel backs out without moving', async () => {
    const move = vi.fn();
    render(<MoveNoteControl api={makeApi({ move })} noteId="n1" fromClientId="c1" clients={clients} />);
    await userEvent.click(screen.getByRole('button', { name: /move to another client/i }));
    await userEvent.selectOptions(await screen.findByLabelText(/move this note to/i), 'c2');
    await userEvent.click(await screen.findByRole('button', { name: /^Cancel$/i }));
    await waitFor(() => expect(screen.queryByTestId('move-note-preview')).toBeNull());
    expect(move).not.toHaveBeenCalled();
  });
});
