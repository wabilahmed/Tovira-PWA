import { ReceiptThread } from '../../receipts/ReceiptThread.js';
import { aiText } from '../../format/aiText.js';

/**
 * [P69 · owner] "What they care about": what the client said about themselves (a personal detail, an ask, a
 * worry), each with the message it came from. It states what the client said; it adds no advice. Used at the top
 * of the client page and of the pre-meeting brief.
 */
export interface CareItem {
  kind: 'detail' | 'ask' | 'worry';
  text: string;
  /** Someone other than the client (e.g. "Layla" at Marina Estates); null when it is the client. */
  subject: string | null;
  noteId: string;
  quote: string | null;
  at: string | null;
}

export const CARES_TITLE = 'What they care about';
export const CARES_EMPTY = 'Nothing yet. When a client mentions what matters to them, it shows here.';

export function caresSummary(items: CareItem[] | undefined): string | null {
  const first = items?.[0];
  if (!first) return null;
  const line = first.subject ? `${first.subject}: ${first.text}` : first.text;
  return items!.length > 1 ? `${line} · ${items!.length - 1} more` : line;
}

export function CaresAboutList({ items }: { items: CareItem[] }): JSX.Element {
  if (items.length === 0) return <p className="tov-muted" style={{ margin: 0 }}>{CARES_EMPTY}</p>;
  return (
    <ul data-testid="cares-about" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--space-3)' }}>
      {items.map((c, i) => (
        <li key={`${c.kind}-${i}`} data-kind={c.kind}>
          <div dir="auto" style={{ fontWeight: 600 }}>{c.subject ? `${c.subject}: ` : ''}{aiText(c.text)}</div>
          {c.quote ? (
            <ReceiptThread refInfo={{ noteId: c.noteId, span: c.quote, quote: c.quote, at: c.at }} />
          ) : (
            // A worry stores no quote: show the conversation it came from rather than guess the message.
            <details style={{ marginTop: 'var(--space-1)' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 'var(--text-secondary-size)' }}>From this conversation</summary>
              <ReceiptThread refInfo={{ noteId: c.noteId }} conversation={c.noteId} />
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
