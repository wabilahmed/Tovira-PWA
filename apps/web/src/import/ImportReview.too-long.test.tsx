import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportReview, type ReviewResult } from './ImportReview.js';

// [P69 · owner] "Reading…" → "Analysing…" everywhere (one voice): the pinned wording below changed by owner decision.

/** [P67-1 · owner] A chat too long to analyse in one go shows why on its row and is never imported; the rest import. */
describe('<ImportReview> a too-long chat', () => {
  // [P79-EMERGENCY · owner, 19 Nov] "refuse any import over 3,000 messages after the date cut, with the message 'This chat is too long for now. We're working on it. Try a shorter chat.'" Until P68, windowed or not. The pin moves with this note.
  it('says the owner\'s too-long line, and is left out of the import', async () => {
    const onImport = vi.fn();
    const result: ReviewResult = { repName: 'Wabil', needsRepId: false, rows: [
      { fileName: 'long.txt', platform: 'android', state: 'too_long', counterpart: 'Anjali Mehra', messageCount: 6240, limit: 5000 },
      { fileName: 'b.txt', platform: 'android', state: 'new', counterpart: 'Omar' },
    ] };
    render(<ImportReview result={result} onImport={onImport} />);
    const rowEl = screen.getByTestId('review-row-long.txt');
    expect(within(rowEl).getByTestId('row-too-long')).toHaveTextContent(
      "Anjali Mehra: This chat is too long for now. We're working on it. Try a shorter chat. Excluded.",
    );
    await userEvent.click(screen.getByRole('button', { name: /^import/i }));
    expect(onImport).toHaveBeenCalledWith([{ fileName: 'b.txt', action: 'new', name: 'Omar' }]);
  });
});
