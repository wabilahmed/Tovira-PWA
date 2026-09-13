import { useState } from 'react';

/** The rep-facing choice. 'lost' becomes lost_confirmed server-side; 'open' also resets the
 *  going-quiet clock. Mirrors POST /clients/:id/outcome. */
export type OutcomeChoice = 'won' | 'lost' | 'open';
export type ClientOutcome = 'open' | 'won' | 'lost_confirmed' | 'lost_inferred';

export interface OutcomeControlProps {
  clientName: string;
  /** Persist the choice (the surface calls the API). May be async — buttons disable while it runs. */
  onChoose: (choice: OutcomeChoice) => void | Promise<void>;
  /** The client's current stored outcome, so the matching button reads as pressed. */
  current?: ClientOutcome;
  disabled?: boolean;
}

/**
 * [OUTCOME-3] One reusable confirm control — won / lost / still open — reusing the ConfirmChit
 * button idiom (.tov-chit-action, quiet outlines, never claret) rather than inventing a second
 * pattern. Each button carries a real text label AND an aria-label naming the client, so the choice
 * is conveyed by words, never colour or icon alone. Reversible: the rep can pick a different outcome
 * at any time. A lost_confirmed OR an inferred loss both read as the "Lost" button pressed.
 */
export function OutcomeControl({ clientName, onChoose, current = 'open', disabled = false }: OutcomeControlProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const pressedFor = (choice: OutcomeChoice): boolean =>
    (choice === 'won' && current === 'won') ||
    (choice === 'lost' && (current === 'lost_confirmed' || current === 'lost_inferred')) ||
    (choice === 'open' && current === 'open');

  async function choose(choice: OutcomeChoice): Promise<void> {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await onChoose(choice);
    } finally {
      setBusy(false);
    }
  }

  const btn = (choice: OutcomeChoice, label: string, aria: string): JSX.Element => (
    <button
      type="button"
      className="tov-chit-action"
      aria-label={aria}
      aria-pressed={pressedFor(choice)}
      disabled={busy || disabled}
      onClick={() => void choose(choice)}
    >
      {label}
    </button>
  );

  return (
    <div className="tov-outcome-control" role="group" aria-label={`Deal outcome for ${clientName}`}>
      {btn('won', 'Won', `Mark ${clientName} won`)}
      {btn('lost', 'Lost', `Mark ${clientName} lost`)}
      {btn('open', 'Still open', `Mark ${clientName} still open`)}
    </div>
  );
}
