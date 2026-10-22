import { ReceiptThread } from '../receipts/ReceiptThread.js';
import type { MatchSuggestion as Match } from './inventoryClient.js';

/** Confidence as a WORD — never a percentage the rep reads as precision (§4/§10). */
const LABEL: Record<Match['confidence'], string> = { strong: 'Strong match', possible: 'Possible match' };

/**
 * [INV-MATCH] The one match-suggestion chit — the pattern the brief (the primary surface) sets and
 * every other surface reuses. The receipt is visible WITHOUT a tap: the client's quoted words + the
 * date they asked, inline (a suggestion is a claim, and no claim ships without its evidence). Share
 * and Dismiss are both present; dismissing here removes the match from every surface (one row).
 */
export function MatchSuggestion({
  match,
  heading,
  onShare,
  onDismiss,
  onOpenNote,
  busy = false,
}: {
  match: Match;
  /** What to name at the top. The brief names the ITEM to offer; the item card names the CLIENT who asked. */
  heading?: string;
  onShare: (matchId: string) => void;
  onDismiss: (matchId: string) => void;
  onOpenNote?: (noteId: string) => void;
  busy?: boolean;
}): JSX.Element {
  return (
    <div
      data-testid="match-suggestion"
      style={{ display: 'grid', gap: 'var(--space-2)', padding: 'var(--space-2)', border: '1px solid var(--rule)', borderRadius: '0.5rem' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'baseline' }}>
        <strong>{heading ?? match.itemTitle}</strong>
        <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-secondary-size)', whiteSpace: 'nowrap' }}>{LABEL[match.confidence]}</span>
      </div>
      {/* The receipt — the client's own words, always visible (no disclosure tap); [P35-3] as the chat it came from. */}
      <ReceiptThread compact={false} refInfo={{ noteId: match.receipt.noteId, span: match.receipt.requirementRaw, at: match.receipt.statedOn, quote: match.receipt.requirementRaw }} />
      {onOpenNote && <button type="button" className="tov-link" style={{ justifySelf: 'start' }} onClick={() => onOpenNote(match.receipt.noteId)}>Open the note</button>}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="button" onClick={() => onShare(match.matchId)} disabled={busy}>Share</button>
        <button type="button" onClick={() => onDismiss(match.matchId)} disabled={busy} style={{ background: 'none', color: 'var(--text-secondary)' }}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
