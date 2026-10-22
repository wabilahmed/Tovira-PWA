import type { ReactNode } from 'react';
import { Button, ActionRow } from '../ui/Button.js';
import { Card } from '../ui/Card.js';
import type { CardCopy } from './cardCopy.js';

/**
 * [P39-6] A "Needs your answer" card: the question → one line on what Yes does → the receipt → the answers, 16px
 * between blocks (the Card's own gap), nothing overlapping. A guess is asked as a question, never shown as a fact.
 * No "Worth checking" eyebrow and no "?" chip: the question carries the doubt. Neither answer is destructive —
 * saying No to a guess loses nothing true — so No is a quiet secondary button, never danger. dir="auto": an Arabic
 * question reads right-to-left.
 */
export function AnswerCard({ copy, source, onYes, onNo, label = 'Needs your answer', testId }: {
  copy: CardCopy;
  /** The card's receipt (ReceiptThread). */
  source?: ReactNode;
  onYes: () => void;
  onNo: () => void;
  label?: string;
  testId?: string;
}): JSX.Element {
  return (
    <Card role="group" aria-label={label} data-testid={testId ?? 'answer-card'}>
      <p className="ui-body ui-strong" dir="auto" data-testid="answer-question">{copy.question}</p>
      <p className="ui-secondary" data-testid="answer-consequence">{copy.consequence}</p>
      {source}
      <ActionRow>
        <Button variant="primary" size="sm" onClick={onYes}>{copy.yes}</Button>
        <Button size="sm" onClick={onNo}>{copy.no}</Button>
      </ActionRow>
    </Card>
  );
}
