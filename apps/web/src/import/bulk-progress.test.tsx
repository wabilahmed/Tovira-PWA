import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BulkImportResult, bulkProgressLine } from './BulkImportResult.js';

// [P65-4 · owner] Bulk import shows its progress per chat: "3 of 8 chats done" while it runs, each chat's own state.
describe('[P65-4] bulk import progress', () => {
  it('"3 of 8 chats done" while chats are still being read; a failed chat counts as done (finished)', () => {
    const jobs = [
      { key: 'a.txt', state: 'done' as const }, { key: 'b.txt', state: 'done' as const }, { key: 'c.txt', state: 'failed' as const },
      { key: 'd.txt', state: 'extracting' as const }, ...['e', 'f', 'g', 'h'].map((k) => ({ key: `${k}.txt`, state: 'queued' as const })),
    ];
    render(<BulkImportResult jobs={jobs} />);
    expect(screen.getByTestId('bulk-progress')).toHaveTextContent('3 of 8 chats done');
    expect(screen.getByTestId('result-row-d.txt')).toHaveTextContent('Analysing…');
  });
  it('NEGATIVE: once every chat is finished, no progress line (the summary takes over)', () => {
    render(<BulkImportResult jobs={[{ key: 'a.txt', state: 'done' }]} summary={{ chatsImported: 1, promises: 2, requirements: 1 }} />);
    expect(screen.queryByTestId('bulk-progress')).toBeNull();
    expect(bulkProgressLine([{ key: 'a', state: 'queued' }])).toBe('0 of 1 chat done');
  });
});
