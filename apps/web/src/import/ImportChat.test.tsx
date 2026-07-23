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
    expect(api.importWhatsApp).toHaveBeenCalledWith('c1', 'Sara: hi there', true);
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

  // Reading a .txt file populates the content (so consent alone then enables submit).
  it('reads an uploaded .txt file into the content', async () => {
    const user = userEvent.setup();
    render(<ImportChat clientId="c1" api={makeApi({ ok: true, imported: 1 })} onImported={vi.fn()} />);
    const file = new File(['[2026-01-15, 09:00:00] Sara: hello'], 'chat.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText(/chat export file/i), file);
    await waitFor(() => expect(screen.getByLabelText(/pasted chat export/i)).toHaveValue('[2026-01-15, 09:00:00] Sara: hello'));
  });
});
