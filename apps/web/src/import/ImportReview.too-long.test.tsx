import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportReview, type ReviewResult } from './ImportReview.js';

/** [P67-1 · owner] A chat too long to read in one go shows why on its row and is never imported; the rest import. */
describe('<ImportReview> a too-long chat', () => {
  it('says how long, the limit and the way out, and is left out of the import', async () => {
    const onImport = vi.fn();
    const result: ReviewResult = { repName: 'Wabil', needsRepId: false, rows: [
      { fileName: 'long.txt', platform: 'android', state: 'too_long', counterpart: 'Anjali Mehra', messageCount: 6240, limit: 5000 },
      { fileName: 'b.txt', platform: 'android', state: 'new', counterpart: 'Omar' },
    ] };
    render(<ImportReview result={result} onImport={onImport} />);
    const rowEl = screen.getByTestId('review-row-long.txt');
    expect(within(rowEl).getByTestId('row-too-long')).toHaveTextContent(
      "Anjali Mehra: This chat is too long to read in one go: 6,240 messages, and the limit for now is 5,000. WhatsApp can't export part of a chat, so contact us at hello@tovira.io and we'll help. Excluded.",
    );
    await userEvent.click(screen.getByRole('button', { name: /^import/i }));
    expect(onImport).toHaveBeenCalledWith([{ fileName: 'b.txt', action: 'new', name: 'Omar' }]);
  });
});
