import type { BookScanItem } from './bookScanClient.js';

/**
 * [BOOKSCAN-STREAM task 3] Findings have no server id, and the server returns them grouped by CATEGORY
 * — so a late-arriving promise lands mid-list on re-fetch, and the section-grouped UI re-sorts on every
 * render. Stability therefore has to come from the CLIENT, not from trusting server order.
 *
 * Identity is derived from `kind | clientId | quote | date` — the tuple that uniquely names a finding:
 * two findings identical on all four ARE the same finding (a given client's given quote of a given kind
 * on a given date). Quote is the verbatim receipt, so it is stable across re-fetches (extraction is
 * idempotent per note; the receipt text does not change once written).
 */
export function findingId(item: BookScanItem): string {
  return `${item.kind}|${item.clientId}|${item.receipt.quote}|${item.receipt.date ?? ''}`;
}

/**
 * Accumulate findings APPEND-ONLY: keep everything already shown in its existing position, and append
 * any not-yet-seen findings from the latest poll (in that poll's order). Existing entries NEVER move,
 * and the server's per-poll reordering is ignored — the visible order is arrival order.
 */
export function appendFindings(prev: BookScanItem[], incoming: BookScanItem[]): BookScanItem[] {
  const seen = new Set(prev.map(findingId));
  const additions = incoming.filter((i) => !seen.has(findingId(i)));
  return additions.length > 0 ? [...prev, ...additions] : prev;
}
