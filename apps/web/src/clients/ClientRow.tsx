import type { JSX } from 'react';
import { IconButton } from '../ui/Button.js';
import { ListRow } from '../ui/ListRow.js';
import type { ClientSummary } from './clientsClient.js';
import { LeadStatusPill } from './LeadStatus.js';
import { ago } from './page/clientPageClient.js';
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

/** [P36-6] What a row says about the client (GET /clients/row-summaries). */
export interface RowSummary { listLine: string | null; lastMessageAt: string | null; overduePromises: number; aliases: string[] }

/** "Last message 3 days ago · 1 overdue promise" — empty when there is neither. */
export function rowActivity(s: RowSummary | undefined, nowMs: number): string {
  if (!s) return '';
  return [
    s.lastMessageAt ? `Last message ${ago(s.lastMessageAt, nowMs)}` : null,
    s.overduePromises > 0 ? `${s.overduePromises} overdue promise${s.overduePromises === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');
}

const MATCH_LABEL: Record<Exclude<MatchField, 'name'>, string> = { alias: 'also known as', phone: 'phone', email: 'email' };

/** [P39] One client row, on the system ListRow: the name; what they want ("4BR Villa · Mirdif · AED 3.4M");
 *  "Last message 11 days ago · 1 overdue promise"; and, trailing, the status (when set) and ⋯ for the status
 *  sheet. When `match` is present (an active search), the matched field is shown and highlighted. [UI-04] the
 *  open button is named "Open {name}" so a screen reader never just announces "button". */
export function ClientRow({
  client,
  onOpen,
  onOpenStatus,
  match,
  summary,
}: {
  client: ClientSummary;
  onOpen: () => void;
  onOpenStatus: () => void;
  match?: { field: MatchField; value: string; ranges: HlRange[] };
  summary?: RowSummary;
}): JSX.Element {
  const activity = rowActivity(summary, Date.now());
  return (
    <ListRow
      openLabel={`Open ${client.name}`}
      onOpen={onOpen}
      title={match?.field === 'name' ? <Highlighted value={client.name} ranges={match.ranges} /> : client.name}
      note={match && match.field !== 'name' ? (
        <span data-testid={`match-${match.field}`}>{MATCH_LABEL[match.field]}: <Highlighted value={match.value} ranges={match.ranges} /></span>
      ) : undefined}
      secondary={summary?.listLine ?? undefined}
      meta={activity || undefined}
      trailing={
        <>
          {/* [P36-6] A pill only for a real status — none on a row with no status. */}
          {client.leadStatus && (
            <span data-testid={`lead-pill-${client.id}`}>
              <LeadStatusPill status={client.leadStatus} onClick={onOpenStatus} />
            </span>
          )}
          {/* [P36-7] Sort the list without opening every client: the row's own status menu. */}
          <IconButton label="Change status" aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); onOpenStatus(); }}>⋯</IconButton>
        </>
      }
    />
  );
}
