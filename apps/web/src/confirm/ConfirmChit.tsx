/**
 * The confirmation-queue chit (board §6): an unconfirmed guess, shown honestly
 * as a guess and never as a fact. A neutral "?" marker + "worth checking" label
 * carry the doubt ([P34-4]: a tick means "done", so it is kept ONLY for the
 * confirmed state, where it turns brass). Both replies — Confirm and
 * Not right — are quiet outlines, never claret, because rejecting a guess is not
 * destructive. One component everywhere: an Arabic guess renders RTL, with any
 * mono value held LTR.
 */
const ARABIC = /[؀-ۿ]/;

export interface ConfirmChitProps {
  text: string;
  /** [P34-2] Whose card this is — the client's name in bold before the text ("Sara Khan — …"). */
  who?: string;
  /** [P34-2] A client-owned promise reads "<who> promised: <text>". */
  promised?: boolean;
  /** [P34-7] The card's source line (SourceLine), under the text. */
  source?: React.ReactNode;
  /** An optional rep-entered value (AED) — still a guess, so it sits in the chit. */
  aed?: number;
  /** Once confirmed, the tick reads brass (a fact) rather than amber. */
  confirmed?: boolean;
  onConfirm: () => void;
  onReject: () => void;
}

export function ConfirmChit({ text, who, promised = false, source, aed, confirmed = false, onConfirm, onReject }: ConfirmChitProps): JSX.Element {
  const rtl = ARABIC.test(text);
  return (
    <div className="tov-confirm-chit" role="group" aria-label="Unconfirmed — worth checking">
      <div className="tov-confirm-chit__head">
        <span
          className="tov-confirm-chit__tick"
          data-testid="confirm-chit-tick"
          data-confirmed={confirmed ? 'true' : 'false'}
          role="img"
          aria-label={confirmed ? 'Confirmed' : 'Needs your check'}
        >
          {confirmed ? '✓' : '?'}
        </span>
        <span className="tov-stamp tov-confirm-chit__label">Worth checking</span>
      </div>
      <p
        className="tov-confirm-chit__text"
        data-testid="confirm-chit-text"
        {...(rtl ? { dir: 'rtl' as const, lang: 'ar' } : {})}
      >
        {who && <><strong>{who}</strong>{promised ? ' promised: ' : ' — '}</>}
        <span>{text}</span>
        {aed !== undefined && (
          <>
            {' '}
            <span className="tov-mono tov-confirm-chit__value">AED {new Intl.NumberFormat('en-US').format(aed)}</span>
          </>
        )}
      </p>
      {source}
      <div className="tov-confirm-chit__actions">
        <button type="button" className="tov-chit-action" onClick={onConfirm}>Confirm</button>
        <button type="button" className="tov-chit-action" onClick={onReject}>Not right</button>
      </div>
    </div>
  );
}
