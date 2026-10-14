import type { CSSProperties, JSX } from 'react';
import type { ClientSummary } from './clientsClient.js';
import { LeadStatusPill } from './LeadStatus.js';
import { formatMonthYear } from '../format/dates.js';
import type { Range as HlRange, MatchField } from './searchClients.js';

/** [CLIENT-SEARCH] Render a field value with the matched range(s) wrapped in <mark>. */
export function Highlighted({ value, ranges }: { value: string; ranges: HlRange[] }): JSX.Element {
  if (ranges.length === 0) return <>{value}</>;
  const parts: JSX.Element[] = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    if (r.start > cursor) parts.push(<span key={`p${i}`}>{value.slice(cursor, r.start)}</span>);
    parts.push(<mark key={`m${i}`} className="lead-mark">{value.slice(r.start, r.end)}</mark>);
    cursor = r.end;
  });
  if (cursor < value.length) parts.push(<span key="tail">{value.slice(cursor)}</span>);
  return <>{parts}</>;
}

const openButton: CSSProperties = {
  background: 'none', border: 'none', color: 'inherit', cursor: 'pointer',
  display: 'block', flex: '1 1 auto', textAlign: 'left', padding: '0.6rem 0', fontFamily: 'inherit',
  // [UI-01] min-width:0 lets this flex child shrink; wrap a long unbroken name instead of overflowing
  // the row (and shoving the status pill off-screen) at 390px.
  minWidth: 0, overflowWrap: 'anywhere',
};

/** One client row: a full-width button that opens the book, plus the lead-status pill. When `match` is
 *  present (an active search), the matched field is shown and highlighted. [UI-04] the open button has an
 *  explicit accessible name ("Open {name}") so a screen reader never just announces "button". */
export function ClientRow({
  client,
  onOpen,
  onOpenStatus,
  match,
}: {
  client: ClientSummary;
  onOpen: () => void;
  onOpenStatus: () => void;
  match?: { field: MatchField; value: string; ranges: HlRange[] };
}): JSX.Element {
  return (
    <li style={{ borderBottom: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <button aria-label={`Open ${client.name}`} onClick={onOpen} style={openButton}>
        <div>{match?.field === 'name' ? <Highlighted value={client.name} ranges={match.ranges} /> : client.name}</div>
        {match && match.field !== 'name' ? (
          <small className="tov-stamp" data-testid={`match-${match.field}`}>
            {match.field === 'phone' ? 'phone' : 'email'}: <Highlighted value={match.value} ranges={match.ranges} />
          </small>
        ) : (
          <small className="tov-stamp">on file since {formatMonthYear(client.createdAt)}</small>
        )}
      </button>
      <span data-testid={`lead-pill-${client.id}`}>
        <LeadStatusPill status={client.leadStatus} onClick={onOpenStatus} />
      </span>
    </li>
  );
}
