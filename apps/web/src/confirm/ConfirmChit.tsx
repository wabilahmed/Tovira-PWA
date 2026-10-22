import { useId, useState, type ReactNode } from 'react';
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

/**
 * [P40-1] A promise whose date the resolver couldn't read: the question, what was said and when, the receipt, then
 * the answers — the resolver's suggested date (only when it has one), a date picker, Not sure, No due date.
 */
export function DateCard({ question, said, suggested, source, onAnswer }: {
  question: string;
  said: string;
  /** YYYY-MM-DD from the resolver, or null. */
  suggested: { iso: string; label: string } | null;
  source?: ReactNode;
  onAnswer: (a: { dueDate: string } | { dateStatus: 'not_sure' | 'no_due_date' }) => void;
}): JSX.Element {
  const [picked, setPicked] = useState('');
  const id = useId();
  return (
    <Card role="group" aria-label="Date to confirm" data-testid="date-card">
      <p className="ui-body ui-strong" dir="auto">{question}</p>
      <p className="ui-secondary" dir="auto">{said}</p>
      {source}
      <ActionRow>
        {suggested && <Button variant="primary" size="sm" onClick={() => onAnswer({ dueDate: suggested.iso })}>Yes, {suggested.label}</Button>}
        <Button size="sm" onClick={() => onAnswer({ dateStatus: 'not_sure' })}>Not sure</Button>
        <Button size="sm" onClick={() => onAnswer({ dateStatus: 'no_due_date' })}>No due date</Button>
      </ActionRow>
      <div className="ui-cluster ui-gap-2">
        <label htmlFor={id} className="sr-only">Pick a date</label>
        <input id={id} type="date" className="ui-input ui-native-select" value={picked} onChange={(e) => setPicked(e.target.value)} />
        <Button size="sm" disabled={!picked} onClick={() => onAnswer({ dueDate: picked })}>Save the date</Button>
      </div>
    </Card>
  );
}

/** [P40-1 · owner] The same question card for a meeting the resolver couldn't time. */
export function MeetingDateCard({ question, said, suggested, source, onAnswer }: {
  question: string;
  said: string;
  suggested: { iso: string; label: string } | null;
  source?: ReactNode;
  onAnswer: (a: { datetime: string } | { dateStatus: 'not_sure' | 'no_date' }) => void;
}): JSX.Element {
  const [picked, setPicked] = useState('');
  const id = useId();
  return (
    <Card role="group" aria-label="Meeting time to confirm" data-testid="meeting-date-card">
      <p className="ui-body ui-strong" dir="auto">{question}</p>
      <p className="ui-secondary" dir="auto">{said}</p>
      {source}
      <ActionRow>
        {suggested && <Button variant="primary" size="sm" onClick={() => onAnswer({ datetime: suggested.iso })}>Yes, {suggested.label}</Button>}
        <Button size="sm" onClick={() => onAnswer({ dateStatus: 'not_sure' })}>Not sure</Button>
        <Button size="sm" onClick={() => onAnswer({ dateStatus: 'no_date' })}>No date yet</Button>
      </ActionRow>
      <div className="ui-cluster ui-gap-2">
        <label htmlFor={id} className="sr-only">Pick a date and time</label>
        <input id={id} type="datetime-local" className="ui-input ui-native-select" value={picked} onChange={(e) => setPicked(e.target.value)} />
        <Button size="sm" disabled={!picked} onClick={() => onAnswer({ datetime: picked })}>Save the time</Button>
      </div>
    </Card>
  );
}
