import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProcessingCard } from './ProcessingCard.js';
import type { ProcessingItem } from './processingClient.js';

// [P65-3 · owner] The status card at the top of the client page: in progress (the real stage, never a fake bar), the
// summary when done (each count opens its section; counts from what was saved), plainly when nothing was found, and why
// it failed, with Try again or the top-up link.
const base: ProcessingItem = { noteId: 'n1', clientId: 'c1', clientName: 'Anjali Mehra', kind: 'chat', state: 'working', startedAt: 0, settledAt: null };
const item = (o: Partial<ProcessingItem>): ProcessingItem => ({ ...base, ...o });
beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });
function show(items: ProcessingItem[]) {
  const props = { items, onOpenSection: vi.fn(), onRetry: vi.fn(async () => true), onTopUp: vi.fn() };
  render(<ProcessingCard {...props} />);
  return props;
}

describe('[P65-3] while it is working', () => {
  it('"Tovira is reading this chat." Usually about N minutes, you can leave, and the real stage', () => {
    show([item({ stage: 'reading', messageCount: 3400, etaMinutes: 2 })]);
    const c = screen.getByTestId('processing-n1');
    expect(c).toHaveTextContent('Tovira is reading this chat.');
    expect(c).toHaveTextContent('Usually about 2 minutes. You can leave this page.');
    expect(within(c).getByTestId('processing-stage')).toHaveTextContent('Reading 3,400 messages');
  });
  it('a voice note says Transcribing; a note waiting for its turn says so; a short note is about a minute', () => {
    show([item({ noteId: 'v', kind: 'voice', stage: 'transcribing', etaMinutes: 2 }), item({ noteId: 't', kind: 'typed', stage: 'waiting', etaMinutes: 1 })]);
    expect(screen.getByTestId('processing-v')).toHaveTextContent('Tovira is reading this voice note.');
    expect(within(screen.getByTestId('processing-v')).getByTestId('processing-stage')).toHaveTextContent('Transcribing');
    expect(screen.getByTestId('processing-t')).toHaveTextContent('Usually about a minute.');
    expect(within(screen.getByTestId('processing-t')).getByTestId('processing-stage')).toHaveTextContent('Waiting to start');
  });
  it('NEGATIVE: never a progress bar or a made-up percentage', () => {
    show([item({ stage: 'reading', messageCount: 3400, etaMinutes: 2 })]);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('processing-n1').textContent).not.toMatch(/%/);
  });
});

describe('[P65-3] when it is done', () => {
  it('the summary: only what was found, each a link to its section, and what needs an answer', async () => {
    const p = show([item({ state: 'done', found: { promises: 4, overduePromises: 1, dates: 2, requirements: 3, people: 2, needsAnswer: 2 } })]);
    const c = screen.getByTestId('processing-n1');
    expect(c).toHaveTextContent('Done. From this chat Tovira found: 4 promises (1 overdue), 2 dates, 3 requirements, 2 people.');
    expect(c).toHaveTextContent('2 things need your answer.');
    const user = userEvent.setup();
    await user.click(within(c).getByRole('button', { name: '4 promises (1 overdue)' }));
    await user.click(within(c).getByRole('button', { name: '2 dates' }));
    await user.click(within(c).getByRole('button', { name: '3 requirements' }));
    await user.click(within(c).getByRole('button', { name: '2 people' }));
    expect(p.onOpenSection.mock.calls.map((x: unknown[]) => x[0])).toEqual(['promises', 'meetings', 'wants', 'people']);
  });
  it('one of each reads in the singular, and a zero count is left out', () => {
    show([item({ state: 'done', found: { promises: 1, overduePromises: 0, dates: 0, requirements: 0, people: 1, needsAnswer: 1 } })]);
    expect(screen.getByTestId('processing-n1')).toHaveTextContent('Done. From this chat Tovira found: 1 promise, 1 person.1 thing needs your answer.');
  });
  it('NEGATIVE: nothing found is said plainly, with a hint; never a silent empty card', () => {
    show([item({ state: 'done', found: { promises: 0, overduePromises: 0, dates: 0, requirements: 0, people: 0, needsAnswer: 0 } })]);
    const c = screen.getByTestId('processing-n1');
    expect(c).toHaveTextContent("Done. Tovira didn't find any promises or dates in this chat.");
    expect(c).toHaveTextContent('Try a chat where you discussed next steps.');
  });
  it('a finished card can be dismissed, and stays dismissed', async () => {
    show([item({ state: 'done', found: { promises: 1, overduePromises: 0, dates: 0, requirements: 0, people: 0, needsAnswer: 0 } })]);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('processing-n1')).toBeNull();
  });
});

describe('[P65-3] when it fails', () => {
  it('on our side: the reason in plain words, and Try again', async () => {
    const p = show([item({ state: 'failed', failure: { reason: 'ours', canRetry: true } })]);
    const c = screen.getByTestId('processing-n1');
    expect(c).toHaveTextContent("Tovira couldn't read this chat.");
    expect(c).toHaveTextContent('Something went wrong on our side.');
    await userEvent.setup().click(within(c).getByRole('button', { name: 'Try again' }));
    expect(p.onRetry).toHaveBeenCalledWith('n1');
  });
  it('the allowance used up: the reason, that it is saved, and the top-up link', async () => {
    const p = show([item({ state: 'held', hold: 'allowance' })]);
    const c = screen.getByTestId('processing-n1');
    expect(c).toHaveTextContent("Tovira couldn't read this chat.");
    expect(c).toHaveTextContent('Your monthly AI allowance is used up.');
    expect(c).toHaveTextContent('It’s saved. Tovira reads it as soon as you top up.');
    await userEvent.setup().click(within(c).getByRole('button', { name: 'Buy more usage' }));
    expect(p.onTopUp).toHaveBeenCalled();
  });
  it('NEGATIVE: a recording that never arrived offers no Try again (there is nothing to read)', () => {
    show([item({ kind: 'voice', state: 'failed', failure: { reason: 'recording_missing', canRetry: false } })]);
    const c = screen.getByTestId('processing-n1');
    expect(c).toHaveTextContent("Tovira couldn't read this voice note.");
    expect(c).toHaveTextContent('The recording was not found');
    expect(within(c).queryByRole('button', { name: 'Try again' })).toBeNull();
  });
  it('NEGATIVE: a held or working card cannot be dismissed (it is not finished)', () => {
    show([item({ state: 'held', hold: 'allowance' }), item({ noteId: 'n2' })]);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });
});
