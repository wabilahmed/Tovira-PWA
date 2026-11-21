import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProcessingCard } from './ProcessingCard.js';
import type { ProcessingItem } from './processingClient.js';

/**
 * [P84-6 / P84-9 · owner, 22 Nov] A chat held for messages: "Waiting for messages: add messages to read this chat",
 * with the pack options. A chat that could not be read: "Couldn't read this chat. Your messages weren't used."
 */
const base: ProcessingItem = { noteId: 'n1', clientId: 'c1', clientName: 'Anjali Mehra', kind: 'chat', state: 'held', hold: 'messages', messageCount: 1240, startedAt: 0, settledAt: null };
const PACKS = [{ id: 'topup_50', label: '+1,500 messages' }, { id: 'topup_100', label: '+3,000 messages' }, { id: 'topup_150', label: '+5,000 messages' }];
beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

describe('[P84-9] a chat waiting for messages', () => {
  it('says so, offers the three packs and "Choose your own amount", each opening the purchase screen', async () => {
    const onTopUp = vi.fn();
    render(<ProcessingCard items={[base]} onOpenSection={vi.fn()} onRetry={vi.fn(async () => true)} onTopUp={onTopUp} packs={PACKS} />);
    const c = screen.getByTestId('processing-n1');
    expect(c).toHaveAttribute('data-state', 'held');
    expect(c).toHaveTextContent('Waiting for messages: add messages to read this chat');
    expect(within(c).getAllByRole('button').map((b) => b.textContent)).toEqual(['+1,500 messages', '+3,000 messages', '+5,000 messages', 'Choose your own amount']);
    await userEvent.click(within(c).getByRole('button', { name: '+3,000 messages' }));
    expect(onTopUp).toHaveBeenCalled();
    expect(c.textContent).not.toMatch(/AED|%/);
  });
  it('a trial (no packs to buy) is offered Subscribe instead', async () => {
    const onSubscribe = vi.fn();
    render(<ProcessingCard items={[base]} onOpenSection={vi.fn()} onRetry={vi.fn(async () => true)} onSubscribe={onSubscribe} packs={[]} />);
    const c = screen.getByTestId('processing-n1');
    expect(c).toHaveTextContent('Waiting for messages: add messages to read this chat');
    await userEvent.click(within(c).getByRole('button', { name: 'Subscribe' }));
    expect(onSubscribe).toHaveBeenCalled();
  });
  it('NEGATIVE: the other holds keep their own words', () => {
    render(<ProcessingCard items={[{ ...base, hold: 'subscribe' }]} onOpenSection={vi.fn()} onRetry={vi.fn(async () => true)} packs={PACKS} />);
    expect(screen.getByTestId('processing-n1')).toHaveTextContent('Your trial has ended.');
    expect(screen.getByTestId('processing-n1')).not.toHaveTextContent('Waiting for messages');
  });
});

describe('[P84-6] a chat that could not be read', () => {
  it('"Couldn\'t read this chat. Your messages weren\'t used." with Try again', () => {
    render(<ProcessingCard items={[{ ...base, state: 'failed', hold: undefined, failure: { reason: 'ours', canRetry: true } }]} onOpenSection={vi.fn()} onRetry={vi.fn(async () => true)} />);
    const c = screen.getByTestId('processing-n1');
    expect(c).toHaveTextContent("Couldn't read this chat. Your messages weren't used.");
    expect(within(c).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  it('NEGATIVE: a voice note that failed keeps its own words (it never used messages)', () => {
    render(<ProcessingCard items={[{ ...base, kind: 'voice', state: 'failed', hold: undefined, failure: { reason: 'recording_missing', canRetry: false } }]} onOpenSection={vi.fn()} onRetry={vi.fn(async () => true)} />);
    const c = screen.getByTestId('processing-n1');
    expect(c).toHaveTextContent('The recording was not found');
    expect(c).not.toHaveTextContent('messages weren');
  });
});
