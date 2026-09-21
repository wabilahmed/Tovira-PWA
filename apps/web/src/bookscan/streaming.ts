import type { BookScanItem } from './bookScanClient.js';

/**
 * [BOOKSCAN-STREAM] Findings arrive grouped by CATEGORY (a late promise lands mid-list on re-fetch) and
 * the UI re-sorts, so stability must come from the CLIENT. Identity is `kind | id`, where `id` is the
 * server-supplied stable identity (a fact row id, or a stable composite for findings with no single
 * backing row). The earlier `kind|clientId|quote|date` key COLLIDED — two distinct promises for the same
 * client on the same date with a null span keyed identically, and appendFindings silently dropped the
 * second (a dropped promise is exactly the failure the Book Scan exists to prevent). `id` is unique and
 * independent of whether a quote exists.
 */
export function findingId(item: BookScanItem): string {
  return `${item.kind}|${item.id}`;
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
