import type { JSX } from 'react';
import { BottomSheet } from '../shell/BottomSheet.js';
import { Chip, ChipGroup } from '../ui/Chips.js';
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
  { value: 'unsorted', label: 'No status' }, // [P39 · owner] was "Unsorted"
];

/** Bucket a client's (possibly absent / null) lead_status into a filter key. */
export function leadFilterKey(status: LeadStatus | null | undefined): Exclude<LeadFilter, 'all'> {
  return status ?? 'unsorted';
}

/** The display label for a status value (null → Unsorted). */
export function leadStatusLabel(status: LeadStatus | null | undefined): string {
  return LEAD_STATUSES.find((s) => s.value === status)?.label ?? 'No status';
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

/** The filter chip row: All · Warm · Cold · Done · No status, each with its count. [P39] A ChipGroup: it scrolls
 *  sideways with a fade at the edge, so a chip is never clipped ("Unsor…"). */
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
    <ChipGroup label="Filter clients by status">
      {LEAD_FILTERS.map((f) => (
        <Chip key={f.value} selected={filter === f.value} count={counts[f.value]} onClick={() => onChange(f.value)} data-testid={`lead-filter-${f.value}`}>
          {f.label}
        </Chip>
      ))}
    </ChipGroup>
  );
}

/** [P36-7] What Tovira's existing inference points at (gone quiet / lost_inferred) — shown, never applied. */
export interface StatusSuggestion { status: 'cold' | 'done'; outcome?: 'lost'; reason: string }

/** [P36-7] Each status, with the one plain line that explains it (the real set: warm / cold / done / none). */
export const STATUS_OPTIONS: ReadonlyArray<{ value: LeadStatus | null; label: string; hint: string; key: string }> = [
  { value: 'warm', label: 'Warm', hint: 'Actively talking. A deal is possible.', key: 'warm' },
  { value: 'cold', label: 'Cold', hint: 'Gone quiet or lost interest', key: 'cold' },
  { value: 'done', label: 'Done', hint: 'Closed. You’ll say whether it was won or lost.', key: 'done' },
  { value: null, label: 'No status', hint: 'Not sorted yet', key: 'unsorted' },
];

/** The bottom sheet: one tap + one choice; the client's current one is marked. [P36-7] An inferred status is
 *  offered above the options as a suggestion with its reason — it changes nothing until the rep taps. */
export function LeadStatusSheet({
  client,
  onPick,
  onClose,
  suggestion,
}: {
  client: ClientSummary | null;
  /** The rep's choice; `outcome` when they took a "Done (lost)" suggestion (no need to ask Won or Lost). */
  onPick: (status: LeadStatus | null, outcome?: 'won' | 'lost') => void;
  onClose: () => void;
  suggestion?: StatusSuggestion | null;
}): JSX.Element {
  const current = client?.leadStatus ?? null;
  const options = STATUS_OPTIONS;
  const suggested = suggestion && suggestion.status !== current ? suggestion : null;
  const suggestedLabel = suggested ? (suggested.status === 'cold' ? 'Cold' : 'Done (lost)') : '';
  return (
    <BottomSheet open={client !== null} onClose={onClose} label="Set lead status" portal>
      {client && (
        <div className="lead-sheet" data-testid="lead-sheet">
          <p className="lead-sheet__title">Status for <strong>{client.name}</strong></p>
          {suggested && (
            <div className="lead-sheet__suggestion" data-testid="lead-suggestion">
              <span>Tovira suggests {suggestedLabel}. {suggested.reason}</span>
              <button type="button" className="tov-link" onClick={() => onPick(suggested.status, suggested.outcome)}>
                {suggested.status === 'cold' ? 'Mark cold' : 'Mark lost'}
              </button>
            </div>
          )}
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

/** [P36-7] Choosing Done asks how it ended — the existing outcome (won / lost). "Not sure yet" leaves it open. */
export function OutcomeSheet({ client, onPick, onClose }: { client: ClientSummary | null; onPick: (outcome: 'won' | 'lost') => void; onClose: () => void }): JSX.Element {
  return (
    <BottomSheet open={client !== null} onClose={onClose} label="Won or lost?" portal>
      {client && (
        <div className="lead-sheet" data-testid="outcome-sheet">
          <p className="lead-sheet__title">Won or lost?</p>
          <p className="lead-sheet__hint" style={{ margin: '0 0 var(--space-2)' }}>{client.name} is done. How did it end?</p>
          <button type="button" className="lead-sheet__option" data-tone="done" onClick={() => onPick('won')}><span className="lead-sheet__label">Won</span></button>
          <button type="button" className="lead-sheet__option" data-tone="cold" onClick={() => onPick('lost')}><span className="lead-sheet__label">Lost</span></button>
          <button type="button" className="tov-link" onClick={onClose}>Not sure yet</button>
        </div>
      )}
    </BottomSheet>
  );
}
