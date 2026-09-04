import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportChat, type ImportApi } from './ImportChat.js';

function makeApi(result: Awaited<ReturnType<ImportApi['importWhatsApp']>>): ImportApi & { importWhatsApp: ReturnType<typeof vi.fn> } {
  return { importWhatsApp: vi.fn().mockResolvedValue(result) };
}

describe('<ImportChat>', () => {
  it('renders the file input, paste box, consent checkbox and submit button', () => {
    render(<ImportChat clientId="c1" api={makeApi({ ok: true, imported: 0 })} onImported={vi.fn()} />);
    expect(screen.getByLabelText(/chat export file/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/pasted chat export/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/consent to import/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import chat/i })).toBeInTheDocument();
  });

  // NEGATIVE: without consent (or content) the button is disabled — can't import.
  it('keeps the button disabled until there is content AND consent', async () => {
    const user = userEvent.setup();
    render(<ImportChat clientId="c1" api={makeApi({ ok: true, imported: 1 })} onImported={vi.fn()} />);
    const button = screen.getByRole('button', { name: /import chat/i });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText(/pasted chat export/i), 'some chat');
    expect(button).toBeDisabled(); // content but no consent

    await user.click(screen.getByLabelText(/consent to import/i));
    expect(button).toBeEnabled();

    await user.click(screen.getByLabelText(/consent to import/i)); // un-consent
    expect(button).toBeDisabled();
  });

  // POSITIVE: content + consent + submit → calls the API and reports the count.
  it('imports and reports the message count on success', async () => {
    const user = userEvent.setup();
    const api = makeApi({ ok: true, imported: 42 });
    const onImported = vi.fn();
    render(<ImportChat clientId="c1" api={api} onImported={onImported} />);

    await user.type(screen.getByLabelText(/pasted chat export/i), 'Sara: hi there');
    await user.click(screen.getByLabelText(/consent to import/i));
    await user.click(screen.getByRole('button', { name: /import chat/i }));

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(42));
    expect(api.importWhatsApp).toHaveBeenCalledWith('c1', { content: 'Sara: hi there' }, true);
  });

  // [P5-1-CEILING-UI] a ceiling-limited import still succeeds (data saved) and
  // shows the non-scary ceiling notice with the processed count.
  it('shows the ceiling notice (not an error) when the trial ceiling was hit', async () => {
    const user = userEvent.setup();
    const api = makeApi({ ok: true, imported: 8, ceilingReached: true });
    const onImported = vi.fn();
    render(<ImportChat clientId="c1" api={api} onImported={onImported} />);

    await user.type(screen.getByLabelText(/pasted chat export/i), 'Sara: hi there');
    await user.click(screen.getByLabelText(/consent to import/i));
    await user.click(screen.getByRole('button', { name: /import chat/i }));

    expect(await screen.findByTestId('ceiling-notice')).toHaveTextContent(/8/);
    expect(screen.queryByRole('alert')).toBeNull(); // not an error
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(8));
  });

  // A shared chat (Android share-target) arrives as initialContent — the paste
  // box is prefilled so the rep only ticks consent and imports.
  it('prefills the paste box from initialContent (a shared chat)', () => {
    render(<ImportChat clientId="c1" api={makeApi({ ok: true, imported: 1 })} onImported={vi.fn()} initialContent={'12/03/2026, 14:02 - Sara: hi'} />);
    expect(screen.getByLabelText(/pasted chat export/i)).toHaveValue('12/03/2026, 14:02 - Sara: hi');
  });

  // A duplicate re-import is a SUCCESS with nothing new — a calm status notice,
  // never the claret "Import failed." that would scare a rep off re-exporting.
  it('shows a calm "up to date" notice on a duplicate re-import, not an error', async () => {
    const user = userEvent.setup();
    const api = makeApi({ ok: true, imported: 0, duplicate: true });
    const onImported = vi.fn();
    render(<ImportChat clientId="c1" api={api} onImported={onImported} />);

    await user.type(screen.getByLabelText(/pasted chat export/i), 'same chat again');
    await user.click(screen.getByLabelText(/consent to import/i));
    await user.click(screen.getByRole('button', { name: /import chat/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/up to date|nothing new/i);
    expect(screen.queryByRole('alert')).toBeNull(); // NOT an error
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(0));
  });

  // NEGATIVE: a rejected import surfaces the error and does NOT call onImported.
  it('shows the server error and does not report success on failure', async () => {
    const user = userEvent.setup();
    const api = makeApi({ ok: false, error: 'not_whatsapp', message: "That doesn't look like a WhatsApp export." });
    const onImported = vi.fn();
    render(<ImportChat clientId="c1" api={api} onImported={onImported} />);

    await user.type(screen.getByLabelText(/pasted chat export/i), 'random junk');
    await user.click(screen.getByLabelText(/consent to import/i));
    await user.click(screen.getByRole('button', { name: /import chat/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/whatsapp export/i);
    expect(onImported).not.toHaveBeenCalled();
  });

  // An uploaded file is read as BYTES and sent base64 (so a .zip survives). It never lands in the
  // paste box; a "Selected:" line confirms it and, with consent, submit sends { contentBase64 }.
  it('reads an uploaded file as bytes and imports it as base64, not text', async () => {
    const user = userEvent.setup();
    const api = makeApi({ ok: true, imported: 1 });
    render(<ImportChat clientId="c1" api={api} onImported={vi.fn()} />);
    const text = '[2026-01-15, 09:00:00] Sara: hello';
    const file = new File([text], 'chat.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText(/chat export file/i), file);
    await waitFor(() => expect(screen.getByText(/selected: chat\.txt/i)).toBeInTheDocument());
    // the paste box stays empty — the bytes did not get stringified into it
    expect(screen.getByLabelText(/pasted chat export/i)).toHaveValue('');
    await user.click(screen.getByLabelText(/consent to import/i));
    await user.click(screen.getByRole('button', { name: /import chat/i }));
    await waitFor(() => expect(api.importWhatsApp).toHaveBeenCalledTimes(1));
    const [cid, payload, consent] = api.importWhatsApp.mock.calls[0]!;
    expect(cid).toBe('c1');
    expect(consent).toBe(true);
    expect(typeof (payload as { contentBase64?: string }).contentBase64).toBe('string');
    expect(atob((payload as { contentBase64: string }).contentBase64)).toBe(text);
  });

  // A .zip shared via the Android share-target arrives as initialContentBase64 (pre-selected file).
  it('imports a shared file (initialContentBase64) as base64', async () => {
    const user = userEvent.setup();
    const api = makeApi({ ok: true, imported: 3 });
    render(<ImportChat clientId="c1" api={api} onImported={vi.fn()} initialContentBase64={btoa('PKzipbytes')} />);
    expect(screen.getByText(/selected: shared chat/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/consent to import/i));
    await user.click(screen.getByRole('button', { name: /import chat/i }));
    await waitFor(() => expect(api.importWhatsApp).toHaveBeenCalledWith('c1', { contentBase64: btoa('PKzipbytes') }, true));
  });
});
