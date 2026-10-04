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
