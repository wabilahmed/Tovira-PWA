import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewClient, type NewClientApi } from './NewClient.js';

// [P57 · owner] Clients → "+ New client": Type it, Record a voice note, Import a WhatsApp chat. The voice flow shows a
// confirm step and creates nothing before the tap; a duplicate name or phone is a question, never a merge.
const client = (id: string, name: string) => ({ id, name, phone: null, createdAt: 1 });
function setup(over: Partial<NewClientApi> = {}, draft: Awaited<ReturnType<NewClientApi['voiceDraft']>> = { ok: true, transcript: "Just met Sara Khan from Emaar, she wants a 3-bed, I said I'd send options by Thursday.", suggestion: { name: 'Sara Khan', company: 'Emaar', phone: null } }) {
  const api: NewClientApi = {
    createNew: vi.fn(async (i) => ({ ok: true as const, client: client('new1', i.name) })),
    createPasteNote: vi.fn(async () => ({})),
    voiceDraft: vi.fn(async () => draft),
    ...over,
  };
  const blob = new Blob(['audio']);
  const startRecorder = vi.fn(async () => ({ ok: true as const, stop: async () => blob }));
  const onSaveRecording = vi.fn(async () => undefined);
  const onDone = vi.fn();
  const onImportChat = vi.fn();
  render(<NewClient open onClose={vi.fn()} api={api} startRecorder={startRecorder} onSaveRecording={onSaveRecording} onDone={onDone} onImportChat={onImportChat} onImportSeveral={vi.fn()} />);
  return { api, blob, onSaveRecording, onDone, onImportChat, user: userEvent.setup() };
}

describe('[P57] + New client', () => {
  it('offers Type it, Record a voice note, and Import a WhatsApp chat (the existing flow)', async () => {
    const { user, onImportChat } = setup();
    expect(screen.getByRole('heading', { name: 'New client' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Type it/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Record a voice note/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Import a WhatsApp chat/ }));
    expect(onImportChat).toHaveBeenCalled();
  });

  it('Type it with only a name: the client is created and no note is sent', async () => {
    const { user, api, onDone } = setup();
    await user.click(screen.getByRole('button', { name: /^Type it/ }));
    expect(screen.getByLabelText('Notes')).toHaveAttribute('placeholder', 'What do you know? Needs, budget, dates, what you promised.');
    await user.type(screen.getByLabelText('Name'), 'Sara Khan');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('new1', expect.objectContaining({ name: 'Sara Khan' })));
    expect(api.createNew).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sara Khan', confirmDuplicate: false }));
    expect(api.createPasteNote).not.toHaveBeenCalled();
  });

  it('Type it with fields and a note: the note goes through the pasted-note path for the new client', async () => {
    const { user, api } = setup();
    await user.click(screen.getByRole('button', { name: /^Type it/ }));
    await user.type(screen.getByLabelText('Name'), 'Sara Khan');
    await user.type(screen.getByLabelText('Company'), 'Emaar');
    await user.type(screen.getByLabelText('Role'), 'Head of leasing');
    await user.type(screen.getByLabelText('Notes'), "Wants a 3-bed. I said I'd send options by Thursday.");
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createPasteNote).toHaveBeenCalledWith('new1', "Wants a 3-bed. I said I'd send options by Thursday."));
    expect(api.createNew).toHaveBeenCalledWith(expect.objectContaining({ company: 'Emaar', title: 'Head of leasing' }));
  });

  it('NEGATIVE: a duplicate is a question; "Add to Sara Khan" adds the note to her client and creates nothing; "Create new" makes a separate one', async () => {
    const createNew = vi.fn(async (i: { name: string; confirmDuplicate?: boolean }) => i.confirmDuplicate
      ? { ok: true as const, client: client('new2', i.name) }
      : { ok: false as const, duplicate: { id: 'c1', name: 'Sara Khan' }, message: 'You already have Sara Khan. Add this to Sara Khan instead?' });
    const { user, api, onDone } = setup({ createNew });
    await user.click(screen.getByRole('button', { name: /^Type it/ }));
    await user.type(screen.getByLabelText('Name'), 'sara khan');
    await user.type(screen.getByLabelText('Notes'), 'Budget 3M.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('You already have Sara Khan. Add this to Sara Khan instead?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create new' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add to Sara Khan' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('c1', null));
    expect(api.createPasteNote).toHaveBeenCalledWith('c1', 'Budget 3M.');
    expect(createNew).toHaveBeenCalledTimes(1);
  });

  it('"Create new" after the duplicate question creates a separate client', async () => {
    const createNew = vi.fn(async (i: { name: string; confirmDuplicate?: boolean }) => i.confirmDuplicate
      ? { ok: true as const, client: client('new2', i.name) }
      : { ok: false as const, duplicate: { id: 'c1', name: 'Sara Khan' }, message: 'You already have Sara Khan. Add this to Sara Khan instead?' });
    const { user, onDone } = setup({ createNew });
    await user.click(screen.getByRole('button', { name: /^Type it/ }));
    await user.type(screen.getByLabelText('Name'), 'Sara Khan');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Create new' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('new2', expect.anything()));
    expect(createNew).toHaveBeenLastCalledWith(expect.objectContaining({ confirmDuplicate: true }));
  });

  it('a voice note with a clear name: the confirm step shows what was said and the name; nothing is created before the tap', async () => {
    const { user, api, blob, onSaveRecording, onDone } = setup();
    await user.click(screen.getByRole('button', { name: /^Record a voice note/ }));
    await user.click(await screen.findByRole('button', { name: '■ Stop' }));
    expect(await screen.findByRole('heading', { name: 'Check the client' })).toBeInTheDocument();
    expect(screen.getByTestId('voice-transcript')).toHaveTextContent('Just met Sara Khan from Emaar');
    expect(screen.getByLabelText('Name')).toHaveValue('Sara Khan');
    expect(screen.getByLabelText('Company')).toHaveValue('Emaar');
    expect(api.createNew).not.toHaveBeenCalled();
    expect(onSaveRecording).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Sara Khan Al Marri');
    await user.click(screen.getByRole('button', { name: 'Create client' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('new1', expect.anything()));
    expect(api.createNew).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sara Khan Al Marri', company: 'Emaar' }));
    expect(onSaveRecording).toHaveBeenCalledWith('new1', blob, expect.any(Number));
  });

  it('a voice note with no name heard asks "Who is this client?" and waits for one', async () => {
    const { user, api } = setup({}, { ok: true, transcript: 'They want the revised quote by Friday.', suggestion: { name: null, company: null, phone: null } });
    await user.click(screen.getByRole('button', { name: /^Record a voice note/ }));
    await user.click(await screen.findByRole('button', { name: '■ Stop' }));
    const name = await screen.findByLabelText('Who is this client?');
    expect(name).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Create client' })).toBeDisabled();
    await user.type(name, 'Omar Haddad');
    expect(screen.getByRole('button', { name: 'Create client' })).toBeEnabled();
    expect(api.createNew).not.toHaveBeenCalled();
  });

  it('NEGATIVE: a transcription failure keeps the recording here and offers Try again; nothing is created', async () => {
    const voiceDraft = vi.fn()
      .mockResolvedValueOnce({ ok: false, kind: 'unavailable', message: "Couldn't transcribe that just now. Your recording is kept on this phone. Try again." })
      .mockResolvedValueOnce({ ok: true, transcript: 'Met Omar.', suggestion: { name: 'Omar', company: null, phone: null } });
    const { user, api } = setup({ voiceDraft });
    await user.click(screen.getByRole('button', { name: /^Record a voice note/ }));
    await user.click(await screen.findByRole('button', { name: '■ Stop' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your recording is kept on this phone');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Name')).toHaveValue('Omar');
    expect(api.createNew).not.toHaveBeenCalled();
  });
});
