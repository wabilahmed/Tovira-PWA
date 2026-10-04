import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportReview, type ReviewResult } from './ImportReview.js';

function result(over: Partial<ReviewResult> = {}): ReviewResult {
  return { repName: 'Wabil', needsRepId: false, rows: [], ...over };
}
const row = (o: Partial<ReviewResult['rows'][number]> & { fileName: string; state: ReviewResult['rows'][number]['state'] }) =>
  ({ platform: 'android' as const, counterpart: null, ...o });

describe('<ImportReview>', () => {
  it('renders one row per file and imports the clear-name rows with no action needed', async () => {
    const onImport = vi.fn();
    render(<ImportReview result={result({ rows: [
      row({ fileName: 'a.txt', state: 'new', counterpart: 'Layla' }),
      row({ fileName: 'b.txt', state: 'new', counterpart: 'Omar' }),
    ] })} onImport={onImport} />);
    expect(screen.getAllByTestId(/^review-row-/)).toHaveLength(2);
    const importBtn = screen.getByRole('button', { name: /^import/i });
    expect(importBtn).toBeEnabled();
    await userEvent.click(importBtn);
    expect(onImport).toHaveBeenCalledWith([
      { fileName: 'a.txt', action: 'new', name: 'Layla' },
      { fileName: 'b.txt', action: 'new', name: 'Omar' },
    ]);
  });

  it('a possible match blocks Import until the rep answers Same person?; Yes merges, No makes a new client', async () => {
    const onImport = vi.fn();
    render(<ImportReview result={result({ rows: [
      row({ fileName: 'a.txt', state: 'possible_match', counterpart: 'Ahmed', matchClientId: 'c1', matchClientName: 'Ahmed' }),
    ] })} onImport={onImport} />);
    const importBtn = screen.getByRole('button', { name: /^import/i });
    expect(importBtn).toBeDisabled();
    // The disabled reason is announced (accessibility).
    expect(screen.getByTestId('import-disabled-reason')).toHaveTextContent(/1 .*needs? (a choice|your answer)/i);
    // Choose "Yes, same person" → merge.
    await userEvent.click(screen.getByRole('radio', { name: /same person/i }));
    expect(importBtn).toBeEnabled();
    await userEvent.click(importBtn);
    expect(onImport).toHaveBeenCalledWith([{ fileName: 'a.txt', action: 'merge', clientId: 'c1' }]);
  });

  it('a possible match answered No imports as a new client under the chat name', async () => {
    const onImport = vi.fn();
    render(<ImportReview result={result({ rows: [
      row({ fileName: 'a.txt', state: 'possible_match', counterpart: 'Ahmed', matchClientId: 'c1', matchClientName: 'Ahmed' }),
    ] })} onImport={onImport} />);
    await userEvent.click(screen.getByRole('radio', { name: /different|new|no/i }));
    await userEvent.click(screen.getByRole('button', { name: /^import/i }));
    expect(onImport).toHaveBeenCalledWith([{ fileName: 'a.txt', action: 'new', name: 'Ahmed' }]);
  });

  it('an unsaved number with an intro suggestion must be confirmed or edited before Import', async () => {
    const onImport = vi.fn();
    render(<ImportReview result={result({ rows: [
      row({ fileName: 'a.txt', state: 'unsaved_intro', counterpart: '+971 50 123 4567', suggestedName: 'Khalid' }),
    ] })} onImport={onImport} />);
    const importBtn = screen.getByRole('button', { name: /^import/i });
    expect(importBtn).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /use.*khalid/i })); // confirm the suggestion
    expect(importBtn).toBeEnabled();
    await userEvent.click(importBtn);
    expect(onImport).toHaveBeenCalledWith([{ fileName: 'a.txt', action: 'new', name: 'Khalid' }]);
  });

  it('an unsaved number with no intro is optional — Import works, keeping the number as the name', async () => {
    const onImport = vi.fn();
    render(<ImportReview result={result({ rows: [
      row({ fileName: 'a.txt', state: 'unsaved_no_intro', counterpart: '+971501234567' }),
    ] })} onImport={onImport} />);
    const importBtn = screen.getByRole('button', { name: /^import/i });
    expect(importBtn).toBeEnabled(); // optional, does not block
    await userEvent.click(importBtn);
    expect(onImport).toHaveBeenCalledWith([{ fileName: 'a.txt', action: 'new', name: '+971501234567' }]);
  });

  it('a group chat is skipped by default (not imported) and does not block Import', async () => {
    const onImport = vi.fn();
    render(<ImportReview result={result({ rows: [
      row({ fileName: 'g.txt', state: 'group', counterpart: null, participants: ['Wabil', 'Khalid', 'Sara'] }),
      row({ fileName: 'b.txt', state: 'new', counterpart: 'Omar' }),
    ] })} onImport={onImport} />);
    const gRow = screen.getByTestId('review-row-g.txt');
    expect(within(gRow).getByText(/group chat\. skipped/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^import/i }));
    expect(onImport).toHaveBeenCalledWith([{ fileName: 'b.txt', action: 'new', name: 'Omar' }]); // group excluded
  });

  it('a duplicate is shown once, references the kept row, and is not imported', async () => {
    const onImport = vi.fn();
    render(<ImportReview result={result({ rows: [
      row({ fileName: 'orig.txt', state: 'new', counterpart: 'Khalid' }),
      row({ fileName: 'again.txt', state: 'duplicate', counterpart: 'Khalid', duplicateOfFileName: 'orig.txt' }),
    ] })} onImport={onImport} />);
    expect(within(screen.getByTestId('review-row-again.txt')).getByText(/same chat as orig\.txt/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^import/i }));
    expect(onImport).toHaveBeenCalledWith([{ fileName: 'orig.txt', action: 'new', name: 'Khalid' }]);
  });

  it('an unparseable file is shown as excluded and does not block Import', async () => {
    const onImport = vi.fn();
    render(<ImportReview result={result({ rows: [
      row({ fileName: 'junk.txt', state: 'unparseable', counterpart: null }),
      row({ fileName: 'b.txt', state: 'new', counterpart: 'Omar' }),
    ] })} onImport={onImport} />);
    expect(within(screen.getByTestId('review-row-junk.txt')).getByText(/could not read/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^import/i }));
    expect(onImport).toHaveBeenCalledWith([{ fileName: 'b.txt', action: 'new', name: 'Omar' }]);
  });

  it('shows the top-up upsell before Import when the batch exceeds the remaining allowance', async () => {
    const onTopUp = vi.fn();
    render(<ImportReview
      result={result({ rows: [row({ fileName: 'a.txt', state: 'new', counterpart: 'Layla' })] })}
      onImport={vi.fn()}
      onTopUp={onTopUp}
      upsell={{ shortfall: true, n: 8, canTopUp: true, recommendedOptionId: 'topup_50', options: [
        { id: 'topup_15', label: '+15%', priceAed: 50 },
        { id: 'topup_50', label: '+50%', priceAed: 85 },
      ] }}
    />);
    expect(screen.getByText(/needs more usage than you have left this month/i)).toBeInTheDocument();
    expect(screen.getByText(/import all 8/i)).toBeInTheDocument();
    const rec = screen.getByTestId('topup-recommended');
    expect(rec).toHaveTextContent(/\+50%.*AED\s*85/i);
    await userEvent.click(rec);
    expect(onTopUp).toHaveBeenCalledWith('topup_50');
    expect(screen.getByRole('button', { name: /^import/i })).toBeEnabled(); // Import still allowed without topping up
  });

  it('a trial sees Subscribe (not top-up prices) when the batch exceeds the allowance', async () => {
    const onSubscribe = vi.fn();
    render(<ImportReview
      result={result({ rows: [row({ fileName: 'a.txt', state: 'new', counterpart: 'Layla' })] })}
      onImport={vi.fn()}
      onSubscribe={onSubscribe}
      upsell={{ shortfall: true, n: 3, canTopUp: false, recommendedOptionId: null, options: [] }}
    />);
    await userEvent.click(screen.getByRole('button', { name: /subscribe to keep importing/i }));
    expect(onSubscribe).toHaveBeenCalledOnce();
    expect(screen.queryByText(/AED/i)).toBeNull(); // no top-up prices for a trial
  });

  it('no upsell banner when the batch fits the allowance', () => {
    render(<ImportReview
      result={result({ rows: [row({ fileName: 'a.txt', state: 'new', counterpart: 'Layla' })] })}
      onImport={vi.fn()}
      upsell={{ shortfall: false, n: 1, canTopUp: true, recommendedOptionId: null, options: [] }}
    />);
    expect(screen.queryByText(/needs more usage/i)).toBeNull();
  });

  it('needs_rep_id: asks "which of these is you?" once, and Import is blocked until the rep answers', async () => {
    const onImport = vi.fn();
    render(<ImportReview result={result({ repName: null, needsRepId: true, rows: [
      row({ fileName: 'a.txt', state: 'needs_rep_id', counterpart: null, participants: ['Wabil', 'Khalid'] }),
    ] })} onImport={onImport} />);
    const importBtn = screen.getByRole('button', { name: /^import/i });
    expect(importBtn).toBeDisabled();
    expect(screen.getByText(/which of these is you/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Wabil' })); // the rep picks themselves
    expect(importBtn).toBeEnabled();
    await userEvent.click(importBtn);
    expect(onImport).toHaveBeenCalledWith([{ fileName: 'a.txt', action: 'new', name: 'Khalid' }]); // the OTHER sender is the counterpart
  });
});
