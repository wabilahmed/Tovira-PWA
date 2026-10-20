import { useState, type ReactNode } from 'react';
import { formatBody } from '../format/dates.js';
import { Receipt } from './Receipt.js';

/**
 * [P34-7] One line of where a card came from, under every Today entry and To Confirm card:
 *   chat        "Sara Khan, 7 May 2026: “…I'll send the floor plans…”"
 *   own note    "Your note, 19 Oct 2026: “…”"   (voice/paste — the rep's own words)
 *   held note   "Your note, 19 Oct 2026"          ("Remember that…" from Ask)
 *   cooling     "Omar Ali, last contact 5 Sep 2026"
 *   no span     "No source quote was saved for this fact"
 * The quote is the STORED text, verbatim (redaction stays as stored), cut to about 90 characters; dates go
 * through the shared formatter (never ISO). A tap expands the full receipt — or `expanded`, when the caller has
 * more to show (a kept-promise suggestion shows both messages).
 */
export type SourceKind = 'message' | 'capture' | 'none' | 'contact' | 'note' | 'pending';

export interface SourceLineProps {
  kind: SourceKind;
  /** The client's name for a chat / contact line. */
  who?: string | null;
  quote?: string | null;
  /** ISO instant, YYYY-MM-DD, or epoch ms. */
  at?: string | number | null;
  /** What a tap reveals; defaults to the full receipt of `quote`. */
  expanded?: ReactNode;
}

const MAX = 90;
/** Cut a quote to about 90 characters at a word boundary, marking the cut with "…". */
export function cutQuote(q: string): string {
  const s = q.trim();
  if (s.length <= MAX) return s;
  const head = s.slice(0, MAX - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > MAX * 0.6 ? head.slice(0, space) : head).replace(/[\s,;:.-]+$/, '')}…`;
}

function lineText({ kind, who, quote, at }: SourceLineProps): string {
  const date = at !== null && at !== undefined ? formatBody(at) : '';
  const q = quote ? `“${cutQuote(quote)}”` : '';
  switch (kind) {
    case 'message': return `${who ?? 'Your note'}${date ? `, ${date}` : ''}${q ? `: ${q}` : ''}`;
    case 'capture': return `Your note${date ? `, ${date}` : ''}${q ? `: ${q}` : ''}`;
    case 'note': return `Your note${date ? `, ${date}` : ''}`;
    case 'contact': return `${who ?? 'This client'}${date ? `, last contact ${date}` : ''}`;
    case 'pending': return 'Source shows after the next refresh';
    case 'none':
    default: return 'No source quote was saved for this fact';
  }
}

export function SourceLine(props: SourceLineProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const canExpand = Boolean(props.expanded) || Boolean(props.quote);
  const text = lineText(props);
  const stamp = props.kind === 'capture' || props.kind === 'note' ? 'Your note' : props.who ?? null;
  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        data-testid="source-line"
        className="tov-source-line"
        aria-expanded={canExpand ? open : undefined}
        disabled={!canExpand}
        onClick={() => setOpen((o) => !o)}
        style={{ all: 'unset', cursor: canExpand ? 'pointer' : 'default', display: 'block', color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.35 }}
      >
        {text}
      </button>
      {open && canExpand && (
        <div style={{ marginTop: 6 }}>
          {props.expanded ?? <Receipt quote={props.quote!} source={stamp} date={typeof props.at === 'number' ? new Date(props.at).toISOString() : props.at ?? null} />}
        </div>
      )}
    </div>
  );
}
