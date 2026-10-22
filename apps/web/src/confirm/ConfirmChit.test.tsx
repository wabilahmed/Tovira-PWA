import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnswerCard } from './ConfirmChit.js';
import { clientPromiseCopy } from './cardCopy.js';

/**
 * [P39-6 · owner] The "Needs your answer" card replaces the P34-4 chit: question → consequence → receipt → answers,
 * in that order. The "Worth checking" eyebrow and the "?" chip are gone (the question carries the doubt); no ✓.
 * (Was: §6 chit with a "worth checking" label, a "?" marker and Confirm / Not right.)
 */
const copy = clientPromiseCopy('QA P14 Gate Client', 'Send ID photos');

describe('[P39-6] <AnswerCard>', () => {
  it('question, then consequence, then receipt, then the answers', () => {
    const { container } = render(<AnswerCard copy={copy} source={<div data-testid="receipt">receipt</div>} onYes={() => {}} onNo={() => {}} />);
    const order = Array.from(container.querySelectorAll('[data-testid="answer-question"], [data-testid="answer-consequence"], [data-testid="receipt"], button')).map((n) => n.getAttribute('data-testid') ?? n.textContent);
    expect(order).toEqual(['answer-question', 'answer-consequence', 'receipt', 'Yes, track it', 'No']);
    expect(screen.getByTestId('answer-question')).toHaveTextContent('Did QA P14 Gate Client promise to send ID photos?');
    expect(screen.getByTestId('answer-consequence')).toHaveTextContent('Yes adds it to their promises.');
  });

  it('the answers call onYes / onNo', async () => {
    const onYes = vi.fn();
    const onNo = vi.fn();
    render(<AnswerCard copy={copy} onYes={onYes} onNo={onNo} />);
    await userEvent.click(screen.getByRole('button', { name: 'Yes, track it' }));
    await userEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(onYes).toHaveBeenCalledTimes(1);
    expect(onNo).toHaveBeenCalledTimes(1);
  });

  it('the answers sit in their own action row; No is never a danger button', () => {
    render(<AnswerCard copy={copy} onYes={() => {}} onNo={() => {}} />);
    const no = screen.getByRole('button', { name: 'No' });
    expect(no.parentElement).toHaveClass('ui-actions');
    expect(no.className).not.toMatch(/danger/);
  });

  it('negative: no "Worth checking" eyebrow, no "?" chip, no ✓', () => {
    const { container } = render(<AnswerCard copy={copy} onYes={() => {}} onNo={() => {}} />);
    expect(container.textContent).not.toMatch(/worth checking/i);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.textContent).not.toContain('✓');
  });

  it('an Arabic question reads right-to-left (dir="auto")', () => {
    render(<AnswerCard copy={{ ...copy, question: 'هل وعد العميل بإرسال الصور؟' }} onYes={() => {}} onNo={() => {}} />);
    expect(screen.getByTestId('answer-question')).toHaveAttribute('dir', 'auto');
  });
});
