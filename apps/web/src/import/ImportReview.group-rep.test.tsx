import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ImportReview, type ReviewResult } from './ImportReview.js';

/** [P21-D] "Import anyway for one participant?" lists the CLIENT candidates only — never the rep. */
const result = (over: Partial<ReviewResult>): ReviewResult => ({ repName: 'Wabil', needsRepId: false, rows: [], ...over });
const group = (participants: string[]) => ({ fileName: 'g.txt', platform: 'android' as const, state: 'group' as const, counterpart: null, participants });

function options(): string[] {
  const select = within(screen.getByTestId('review-row-g.txt')).getByRole('combobox', { name: /client participant for g\.txt/i });
  return within(select).getAllByRole('option').map((o) => o.textContent ?? '');
}

describe('[P21-D] group chat participant picker excludes the rep', () => {
  it('the rep ("Wabil") is not offered', () => {
    render(<ImportReview result={result({ rows: [group(['Wabil', 'Khalid', 'Sara'])] })} onImport={vi.fn()} />);
    expect(options()).toEqual(['Keep skipped', 'Khalid', 'Sara']);
  });

  it('matches the rep through case/spacing differences', () => {
    render(<ImportReview result={result({ repName: 'wabil ', rows: [group(['Wabil', 'Khalid'])] })} onImport={vi.fn()} />);
    expect(options()).toEqual(['Keep skipped', 'Khalid']);
  });

  it('NEGATIVE: with the rep not known yet, every participant is still offered (nothing hidden on a guess)', () => {
    render(<ImportReview result={result({ repName: null, rows: [group(['Wabil', 'Khalid'])] })} onImport={vi.fn()} />);
    expect(options()).toEqual(['Keep skipped', 'Wabil', 'Khalid']);
  });
});
