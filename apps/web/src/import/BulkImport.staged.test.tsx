import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkImport } from './BulkImport.js';
import type { BulkImportApi } from './bulkImportClient.js';

/**
 * [P67 · owner] A chat sent to Tovira on WhatsApp opens straight on the confirm step (the import review) for the batch
 * the server staged: no file picker, no upload, nothing read until the rep confirms who it's with.
 */
function api(rows: Array<{ fileName: string; state: 'new'; counterpart: string }>): BulkImportApi {
  return {
    uploadFile: vi.fn(async () => ({ ok: true })),
    parse: vi.fn(async () => ({ result: { rows: rows.map((r) => ({ ...r, platform: 'ios' as const })), repName: 'Wabil', needsRepId: false }, percentOfAllowance: 3 })),
    startImport: vi.fn(async () => ({ started: true })),
    status: vi.fn(async () => ({ jobs: [], done: true, started: { 'WhatsApp Chat - Anjali Mehra.zip': { clientId: 'c1', noteId: 'n1' } } })),
    abandon: vi.fn(async () => {}),
  };
}

describe('<BulkImport stagedBatchId> (from the WhatsApp reply)', () => {
  it('opens on the review of the staged chat; confirming imports it like a chosen file', async () => {
    const a = api([{ fileName: 'WhatsApp Chat - Anjali Mehra.zip', state: 'new', counterpart: 'Anjali Mehra' }]);
    const onClientReady = vi.fn();
    render(<BulkImport api={a} single pollMs={1} stagedBatchId="wa-123" onClientReady={onClientReady} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^import/i })).toBeInTheDocument());
    expect(a.parse).toHaveBeenCalledWith('wa-123');
    expect(a.uploadFile).not.toHaveBeenCalled();
    expect(a.startImport).not.toHaveBeenCalled(); // nothing read before the rep confirms
    expect(screen.getByText('Anjali Mehra')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^import/i }));
    expect(a.startImport).toHaveBeenCalledWith('wa-123', [{ fileName: 'WhatsApp Chat - Anjali Mehra.zip', action: 'new', name: 'Anjali Mehra' }], undefined);
    await waitFor(() => expect(onClientReady).toHaveBeenCalledWith('c1'));
  });

  it('a chat no longer waiting (cleared after a day) says so and offers the file picker', async () => {
    const a = api([]);
    render(<BulkImport api={a} single pollMs={1} stagedBatchId="wa-old" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This chat is no longer waiting here. Send it to Tovira on WhatsApp again, or choose the file below.');
    expect(screen.getByLabelText(/choose the chat export/i)).toBeInTheDocument(); // the picker
  });
});
