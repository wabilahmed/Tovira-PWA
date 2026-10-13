import type { JSX } from 'react';
import { BottomSheet } from '../shell/BottomSheet.js';
import type { ClientSummary, LeadStatus } from './clientsClient.js';

/**
 * [LEAD-STATUS] The rep's MANUAL pipeline label, surfaced on the Clients list.
 *
 * Four buckets: Warm (active), Cold (gone quiet), Done (satisfied + completed), and Unsorted —
 * the default for every new and imported client (stored as null). Only a rep tap ever changes it;
 * nothing here writes it automatically. Colours come entirely from the brand tokens (no hardcoded
 * hex), each with an AA-tuned text/line/surface trio in BOTH themes:
 *   warm → brass (terracotta, the active accent) · cold → amber (quiet, needs attention) ·
 *   done → green (success) · unsorted → neutral (text-tertiary, no fill).
 */

export type LeadFilter = 'all' | 'warm' | 'cold' | 'done' | 'unsorted';

/** The three real statuses, in pipeline order. Unsorted (null) is handled separately. */
export const LEAD_STATUSES: ReadonlyArray<{ value: LeadStatus; label: string; tone: string }> = [
  { value: 'warm', label: 'Warm', tone: 'warm' },
  { value: 'cold', label: 'Cold', tone: 'cold' },
  { value: 'done', label: 'Done', tone: 'done' },
];

/** The filter chips, in order. `all` first; `unsorted` last (it's the absence of a label). */
export const LEAD_FILTERS: ReadonlyArray<{ value: LeadFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'warm', label: 'Warm' },
  { value: 'cold', label: 'Cold' },
  { value: 'done', label: 'Done' },
  { value: 'unsorted', label: 'Unsorted' },
];

/** Bucket a client's (possibly absent / null) lead_status into a filter key. */
export function leadFilterKey(status: LeadStatus | null | undefined): Exclude<LeadFilter, 'all'> {
  return status ?? 'unsorted';
}

/** The display label for a status value (null → Unsorted). */
export function leadStatusLabel(status: LeadStatus | null | undefined): string {
  return LEAD_STATUSES.find((s) => s.value === status)?.label ?? 'Unsorted';
}

/** Does a client belong in the list under the active filter? */
export function matchesLeadFilter(c: Pick<ClientSummary, 'leadStatus'>, filter: LeadFilter): boolean {
  return filter === 'all' || leadFilterKey(c.leadStatus) === filter;
}

/** Count clients per filter bucket (All = total), from the full loaded list. */
export function leadStatusCounts(clients: ReadonlyArray<Pick<ClientSummary, 'leadStatus'>>): Record<LeadFilter, number> {
  const counts: Record<LeadFilter, number> = { all: clients.length, warm: 0, cold: 0, done: 0, unsorted: 0 };
  for (const c of clients) counts[leadFilterKey(c.leadStatus)]++;
  return counts;
}

/** The small status pill on a client row / in the client book. A button — tapping it opens the sheet. */
export function LeadStatusPill({ status, onClick }: { status: LeadStatus | null | undefined; onClick: () => void }): JSX.Element {
  const key = leadFilterKey(status);
  return (
    <button
      type="button"
      className={`lead-pill lead-pill--${key}`}
      data-tone={key}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={`Lead status: ${leadStatusLabel(status)}. Tap to change.`}
    >
      {leadStatusLabel(status)}
    </button>
  );
}

/** The filter chip row: All · Warm · Cold · Done · Unsorted, each with its count. */
export function LeadStatusFilterBar({
  filter,
  counts,
  onChange,
}: {
  filter: LeadFilter;
  counts: Record<LeadFilter, number>;
  onChange: (f: LeadFilter) => void;
}): JSX.Element {
  return (
    <div className="lead-chips" role="group" aria-label="Filter clients by lead status">
      {LEAD_FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          className="lead-chip"
          data-tone={f.value === 'all' ? undefined : f.value}
          data-testid={`lead-filter-${f.value}`}
          aria-pressed={filter === f.value}
          onClick={() => onChange(f.value)}
        >
          {f.label} <span className="lead-chip__count">{counts[f.value]}</span>
        </button>
      ))}
    </div>
  );
}

/** The bottom sheet: one tap + one choice. Four options; the client's current one is marked. */
export function LeadStatusSheet({
  client,
  onPick,
  onClose,
}: {
  client: ClientSummary | null;
  onPick: (status: LeadStatus | null) => void;
  onClose: () => void;
}): JSX.Element {
  const current = client?.leadStatus ?? null;
  const options: Array<{ value: LeadStatus | null; label: string; hint: string; key: string }> = [
    { value: 'warm', label: 'Warm', hint: 'Active — in play right now', key: 'warm' },
    { value: 'cold', label: 'Cold', hint: 'Gone quiet', key: 'cold' },
    { value: 'done', label: 'Done', hint: 'Satisfied and completed', key: 'done' },
    { value: null, label: 'Unsorted', hint: 'No label yet', key: 'unsorted' },
  ];
  return (
    <BottomSheet open={client !== null} onClose={onClose} label="Set lead status">
      {client && (
        <div className="lead-sheet" data-testid="lead-sheet">
          <p className="lead-sheet__title">Status for <strong>{client.name}</strong></p>
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              className="lead-sheet__option"
              data-tone={o.key}
              data-testid={`lead-option-${o.key}`}
              aria-current={current === o.value ? 'true' : undefined}
              onClick={() => onPick(o.value)}
            >
              <span className={`lead-dot lead-dot--${o.key}`} aria-hidden="true" />
              <span className="lead-sheet__label">{o.label}</span>
              <span className="lead-sheet__hint">{o.hint}</span>
              {current === o.value && <span className="lead-sheet__check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}
