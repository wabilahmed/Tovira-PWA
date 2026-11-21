import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportChat, type ImportApi } from './ImportChat.js';

/** [P82-B · owner, 21 Nov] Before an import is confirmed the rep sees "This chat has 1,240 messages to read. About 3
 *  minutes." (stripped messages, from the server's preview; no cost). The preview never blocks the import. */
const api = (preview: ImportApi['previewImport']): ImportApi => ({
  importWhatsApp: vi.fn(async () => ({ note: { id: 'n1' }, imported: 3 }) as never),
  previewImport: preview,
});

describe('[P82-B] the line before Import', () => {
  it('a pasted chat shows its stripped message count and minutes', async () => {
    const preview = vi.fn(async () => ({ line: 'This chat has 1,240 messages to read. About 5 minutes.' }));
    render(<ImportChat clientId="c1" api={api(preview)} onImported={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/pasted chat export/i), { target: { value: '[01/03/2026, 09:00] A: hello' } });
    expect(await screen.findByTestId('import-reading')).toHaveTextContent('This chat has 1,240 messages to read. About 5 minutes.');
    expect(preview).toHaveBeenCalledWith('c1', expect.objectContaining({ content: '[01/03/2026, 09:00] A: hello' }));
  });
  it('NEGATIVE: a failed preview shows nothing and the import still works', async () => {
    const a = api(vi.fn(async () => null));
    render(<ImportChat clientId="c1" api={a} onImported={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/pasted chat export/i), { target: { value: '[01/03/2026, 09:00] A: hello' } });
    await waitFor(() => expect(a.previewImport).toHaveBeenCalled());
    expect(screen.queryByTestId('import-reading')).toBeNull();
  });
  it('NEGATIVE: no currency or cost on the screen', async () => {
    render(<ImportChat clientId="c1" api={api(vi.fn(async () => ({ line: 'This chat has 3 messages to read. About 1 minute.' })))} onImported={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/pasted chat export/i), { target: { value: 'x' } });
    await screen.findByTestId('import-reading');
    expect(document.body.textContent).not.toMatch(/AED|\$\d|cost|spend/i);
  });
});
