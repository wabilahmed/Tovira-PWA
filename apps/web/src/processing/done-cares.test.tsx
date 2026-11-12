import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProcessingCard } from './ProcessingCard.js';
import { readyToast, type ProcessingItem } from './processingClient.js';

/** [P69 · owner] The done summary leads with what the client cares about: "Done. 3 things Anjali Mehra cares about, 4 promises, 2 dates." */
const done: ProcessingItem = {
  noteId: 'n1', clientId: 'c1', clientName: 'Anjali Mehra', kind: 'chat', state: 'done', startedAt: 0, settledAt: 1,
  found: { caresAbout: 3, promises: 4, overduePromises: 0, dates: 2, requirements: 1, people: 0, needsAnswer: 0 },
};

describe('[P69] the done summary', () => {
  it('the card: "Done. 3 things Anjali Mehra cares about, 4 promises, 2 dates." and the first link opens What they care about', async () => {
    const onOpenSection = vi.fn();
    render(<ProcessingCard items={[done]} onOpenSection={onOpenSection} onRetry={vi.fn(async () => true)} onTopUp={vi.fn()} />);
    expect(screen.getByTestId('processing-n1').querySelector('p')).toHaveTextContent('Done. 3 things Anjali Mehra cares about, 4 promises, 2 dates.');
    await userEvent.setup().click(screen.getByRole('button', { name: '3 things Anjali Mehra cares about' }));
    expect(onOpenSection).toHaveBeenCalledWith('cares');
  });
  it('the toast: "Anjali Mehra is ready: 3 things they care about, 4 promises, 2 dates."', () => {
    expect(readyToast(done)).toBe('Anjali Mehra is ready: 3 things they care about, 4 promises, 2 dates.');
  });
  it('one thing: singular', () => {
    expect(readyToast({ ...done, found: { ...done.found!, caresAbout: 1, promises: 0, dates: 0 } })).toBe('Anjali Mehra is ready: 1 thing they care about.');
  });
});
