import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SharedChatPicker } from './SharedChatPicker.js';
import type { BulkImportApi } from './bulkImportClient.js';
import type { ReviewRow } from './ImportReview.js';

/**
 * [P36-2] A WhatsApp export shared into Tovira opens a client picker: the client the chat matches (by the
 * counterpart's name — a deterministic read, no model) is suggested; "New client" is the alternative. The
 * rep's choice continues on that client's page. Nothing is imported or extracted by the picker itself.
 */
const clients = [{ id: 'c1', name: 'Sara Khan' }, { id: 'c2', name: 'Omar Ali' }];
function api(row: ReviewRow): BulkImportApi {
  return {
    uploadFile: vi.fn(async () => ({ ok: true })),
    parse: vi.fn(async () => ({ result: { rows: [row], repName: 'Wabil', needsRepId: false }, percentOfAllowance: 1 })),
    startImport: vi.fn(async () => ({ started: true })),
    status: vi.fn(async () => ({ jobs: [], done: false })),
    abandon: vi.fn(async () => {}),
  };
}

describe('[P36-2] the share-target client picker', () => {
  it('a chat whose counterpart matches a client suggests that client; choosing it continues on that client', async () => {
    const a = api({ fileName: 'shared chat', platform: 'android', state: 'existing', counterpart: 'Omar Ali', matchClientId: 'c2', matchClientName: 'Omar Ali' });
    const onChoose = vi.fn();
    render(<SharedChatPicker api={a} clients={clients} content="13/07/2019, 1:00 am - Omar Ali: hi" onChooseClient={onChoose} onNewClient={vi.fn()} />);
    const suggested = await screen.findByTestId('shared-suggested');
    expect(suggested).toHaveTextContent('Omar Ali');
    await userEvent.click(screen.getByRole('button', { name: /Omar Ali/ , description: /suggested/i }));
    expect(onChoose).toHaveBeenCalledWith('c2');
    expect(a.startImport).not.toHaveBeenCalled(); // nothing imported by the picker
    expect(a.abandon).toHaveBeenCalled(); // the staged copy used for the match is dropped
  });

  it('an unknown counterpart offers "New client" named after them', async () => {
    const a = api({ fileName: 'shared chat', platform: 'android', state: 'new', counterpart: 'Layla Haddad' });
    const onNew = vi.fn();
    render(<SharedChatPicker api={a} clients={clients} content="13/07/2019, 1:00 am - Layla Haddad: hi" onChooseClient={vi.fn()} onNewClient={onNew} />);
    expect(await screen.findByLabelText('New client name')).toHaveValue('Layla Haddad');
    expect(screen.queryByTestId('shared-suggested')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'New client' }));
    expect(onNew).toHaveBeenCalledWith('Layla Haddad');
    expect(a.startImport).not.toHaveBeenCalled();
  });

  it('every existing client stays pickable (the suggestion is never forced)', async () => {
    const a = api({ fileName: 'shared chat', platform: 'android', state: 'existing', counterpart: 'Omar Ali', matchClientId: 'c2', matchClientName: 'Omar Ali' });
    const onChoose = vi.fn();
    render(<SharedChatPicker api={a} clients={clients} content="x" onChooseClient={onChoose} onNewClient={vi.fn()} />);
    await screen.findByTestId('shared-suggested');
    await userEvent.click(screen.getByRole('button', { name: 'Sara Khan' }));
    expect(onChoose).toHaveBeenCalledWith('c1');
  });
});
