import { Receipt } from '../components/Receipt.js';
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
      style={{ display: 'grid', gap: '0.4rem', padding: '0.6rem', border: '1px solid var(--rule, #e5e0d5)', borderRadius: '0.5rem' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'baseline' }}>
        <strong>{heading ?? match.itemTitle}</strong>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85em', whiteSpace: 'nowrap' }}>{LABEL[match.confidence]}</span>
      </div>
      {/* The receipt — the client's own words + the date, always visible (no disclosure tap). */}
      <Receipt
        quote={match.receipt.requirementRaw}
        date={match.receipt.statedOn}
        onOpen={onOpenNote ? () => onOpenNote(match.receipt.noteId) : undefined}
      />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" onClick={() => onShare(match.matchId)} disabled={busy}>Share</button>
        <button type="button" onClick={() => onDismiss(match.matchId)} disabled={busy} style={{ background: 'none', color: 'var(--text-secondary)' }}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
