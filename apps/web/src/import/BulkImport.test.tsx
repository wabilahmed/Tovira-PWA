import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkImport, BULK_MAX_UPLOAD_BYTES } from './BulkImport.js';
import type { BulkImportApi } from './bulkImportClient.js';
import type { ReviewRow } from './ImportReview.js';

function fakeApi(over: Partial<BulkImportApi> = {}): BulkImportApi {
  const rows: ReviewRow[] = [
    { fileName: 'a.txt', platform: 'android', state: 'new', counterpart: 'Layla' },
    { fileName: 'b.txt', platform: 'android', state: 'new', counterpart: 'Omar' },
  ];
  return {
    uploadFile: vi.fn(async (_b: string, _i: number, _n: string, _bytes: Uint8Array) => ({ ok: true })),
    parse: vi.fn(async () => ({ result: { rows, repName: 'Wabil', needsRepId: false }, percentOfAllowance: 12 })),
    startImport: vi.fn(async () => ({ started: true })),
    status: vi.fn(async () => ({ jobs: [{ key: 'a.txt', state: 'done' as const }, { key: 'b.txt', state: 'done' as const }], done: true })),
    abandon: vi.fn(async () => {}),
    ...over,
  };
}
const txt = (name: string, content = 'hi') => new File([content], name, { type: 'text/plain' });

describe('<BulkImport>', () => {
  it('walks pick → review → progress → result', async () => {
    const api = fakeApi();
    render(<BulkImport api={api} pollMs={1} />);
    await userEvent.upload(screen.getByLabelText(/choose chat exports/i), [txt('a.txt'), txt('b.txt')]);
    // reaches the review screen
    await waitFor(() => expect(screen.getByRole('button', { name: /^import/i })).toBeInTheDocument());
    expect(api.uploadFile).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: /^import/i }));
    // reaches the result (polled to done)
    await waitFor(() => expect(screen.getByTestId('bulk-import-result')).toBeInTheDocument());
    expect(api.startImport).toHaveBeenCalled();
    expect(screen.getAllByTestId(/^result-row-/)).toHaveLength(2);
  });

  it('does NOT silently accept more than 20 files — it asks before keeping the first 20', async () => {
    const api = fakeApi();
    render(<BulkImport api={api} pollMs={1} />);
    const files = Array.from({ length: 21 }, (_, i) => txt(`f${i}.txt`));
    await userEvent.upload(screen.getByLabelText(/choose chat exports/i), files);
    expect(screen.getByTestId('over-cap')).toBeInTheDocument();
    expect(api.uploadFile).not.toHaveBeenCalled(); // nothing uploaded until the rep confirms
    await userEvent.click(screen.getByRole('button', { name: /import the first 20/i }));
    await waitFor(() => expect(api.parse).toHaveBeenCalled());
    expect(api.uploadFile).toHaveBeenCalledTimes(20); // exactly the first 20
  });

  it('an oversized file fails only its own row and is never uploaded', async () => {
    const api = fakeApi();
    render(<BulkImport api={api} pollMs={1} />);
    const big = new File([new Uint8Array(BULK_MAX_UPLOAD_BYTES + 1)], 'huge.txt', { type: 'text/plain' });
    await userEvent.upload(screen.getByLabelText(/choose chat exports/i), [big, txt('a.txt')]);
    await waitFor(() => expect(screen.getByRole('button', { name: /^import/i })).toBeInTheDocument());
    expect(within(screen.getByTestId('review-row-huge.txt')).getByText(/this file is too large/i)).toBeInTheDocument();
    expect(api.uploadFile).toHaveBeenCalledTimes(1); // only the normal file was uploaded
    // the rest of the batch is fine — Import is still available
    expect(screen.getByRole('button', { name: /^import/i })).toBeEnabled();
  });

  it('a mixed .zip + .txt selection reaches the review screen', async () => {
    const api = fakeApi();
    render(<BulkImport api={api} pollMs={1} />);
    const zip = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'chat.zip', { type: 'application/zip' });
    await userEvent.upload(screen.getByLabelText(/choose chat exports/i), [zip, txt('b.txt')]);
    await waitFor(() => expect(screen.getByRole('button', { name: /^import/i })).toBeInTheDocument());
    expect(api.uploadFile).toHaveBeenCalledTimes(2);
    // the .zip was sent as raw bytes (content-by-decode on the server)
    expect((api.uploadFile as ReturnType<typeof vi.fn>).mock.calls.some((c) => c[2] === 'chat.zip' && c[3] instanceof Uint8Array)).toBe(true);
  });

  it('shows the right-to-upload acknowledgement when the server asks, then retries', async () => {
    let asked = false;
    const api = fakeApi({
      startImport: vi.fn(async (_b, _d, ack) => { if (!ack && !asked) { asked = true; return { started: false, needAck: true }; } return { started: true }; }),
    });
    render(<BulkImport api={api} pollMs={1} />);
    await userEvent.upload(screen.getByLabelText(/choose chat exports/i), [txt('a.txt')]);
    await waitFor(() => expect(screen.getByRole('button', { name: /^import/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^import/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /i have the right to upload/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /i have the right to upload/i }));
    await waitFor(() => expect(screen.getByTestId('bulk-import-result')).toBeInTheDocument());
  });
});
