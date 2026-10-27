import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmChitQueue, type SamePersonApi, type SamePersonCard } from './ConfirmChitQueue.js';
import { samePersonCopy } from './cardCopy.js';

// [P50-2 · owner] Needs your answer asks, never guesses: "Is 'Khalid' in this chat the same person as Khalid Al Mansoori?"
// with Same person / Different person and the receipt where the name appears. Answering removes the card.
const confirmApi = { listConfirmations: vi.fn().mockResolvedValue([]), confirm: vi.fn(), reject: vi.fn() };
const card = (over: Partial<SamePersonCard> = {}): SamePersonCard => ({
  id: 'q1', clientId: 'c1', clientName: 'Khalid Al Mansoori', noteId: 'n1', personName: 'Khalid',
  quote: 'Khalid: the driver will bring the keys', quoteAt: '2026-07-13T09:01',
  question: 'Is \'Khalid\' in this chat the same person as Khalid Al Mansoori?', ...over,
});
const api = (cards: SamePersonCard[]): SamePersonApi & { answerSamePerson: ReturnType<typeof vi.fn> } => ({
  listSamePerson: vi.fn().mockResolvedValue(cards),
  answerSamePerson: vi.fn().mockResolvedValue(true),
});

describe('[P50-2] the "same person?" card', () => {
  it('asks the question, says what each answer does, shows the receipt, and offers Same person / Different person', async () => {
    render(<ConfirmChitQueue api={confirmApi} samePerson={api([card()])} />);
    const c = await screen.findByTestId('same-person-card');
    expect(within(c).getByText('Is \'Khalid\' in this chat the same person as Khalid Al Mansoori?')).toBeInTheDocument();
    expect(within(c).getByText(samePersonCopy('Khalid Al Mansoori').consequence)).toBeInTheDocument();
    expect(within(c).getByText(/the driver will bring the keys/)).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Same person' })).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Different person' })).toBeInTheDocument();
  });

  it('Same person answers "same" and the card goes', async () => {
    const a = api([card()]);
    render(<ConfirmChitQueue api={confirmApi} samePerson={a} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Same person' }));
    expect(a.answerSamePerson).toHaveBeenCalledWith('q1', 'same');
    await waitFor(() => expect(screen.queryByTestId('same-person-card')).toBeNull());
  });

  it('Different person answers "different" and the card goes', async () => {
    const a = api([card()]);
    render(<ConfirmChitQueue api={confirmApi} samePerson={a} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Different person' }));
    expect(a.answerSamePerson).toHaveBeenCalledWith('q1', 'different');
    await waitFor(() => expect(screen.queryByTestId('same-person-card')).toBeNull());
  });

  it('NEGATIVE: a failed answer keeps the card (nothing is lost)', async () => {
    const a = { listSamePerson: vi.fn().mockResolvedValue([card()]), answerSamePerson: vi.fn().mockResolvedValue(false) };
    render(<ConfirmChitQueue api={confirmApi} samePerson={a} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Same person' }));
    expect(screen.getByTestId('same-person-card')).toBeInTheDocument();
  });

  it('counts toward the Today section ("See all N")', async () => {
    render(<ConfirmChitQueue api={confirmApi} samePerson={api([card(), card({ id: 'q2', personName: 'Mansoori Trading', question: 'Is \'Mansoori Trading\' in this chat the same person as Khalid Al Mansoori?' }), card({ id: 'q3' }), card({ id: 'q4' })])} limit={3} onSeeAll={() => {}} />);
    expect(await screen.findByRole('button', { name: 'See all 4' })).toBeInTheDocument();
  });

  it('the copy has no em-dash', () => {
    const c = samePersonCopy('Khalid Al Mansoori');
    expect(`${c.consequence}${c.yes}${c.no}`).not.toMatch(/—/);
  });
});
