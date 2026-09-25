import type { ImportedMessage } from '../../ports/note-repository.js';

/**
 * [SCREEN-REVIEW] Pure grouping + restore over a note's messages, for the flag-review surface.
 *
 * The rep reviews HELD (excluded) messages grouped category → matched span, so a dominant false-positive
 * token ("party", "court") can be cleared in one action. Restore flips excluded back to false — the
 * ONLY thing that ever clears it (fail-closed) — and reports the flags it cleared, which become the
 * aggregate restore signal (R2): category + span only, never message content or identifiers.
 */

/** One held message as the rep sees it (their OWN content — the review is allowed to show it). */
export interface HeldMessageView {
  index: number; // position in note.messages — the handle for a targeted restore
  sender: string;
  sentAt: string | null;
  body: string;
}
export interface SpanGroup {
  span: string;
  count: number;
  messages: HeldMessageView[];
}
export interface CategoryGroup {
  category: string;
  count: number; // distinct held messages in this category
  spans: SpanGroup[];
}
export interface FlagReview {
  held: number;
  groups: CategoryGroup[];
}

/** Group a note's HELD messages by category → matched span, with counts and the message views. */
export function groupHeldFlags(messages: ImportedMessage[]): FlagReview {
  const held = messages.map((m, i) => ({ m, i })).filter((x) => x.m.excluded === true);
  const byCat = new Map<string, { msgIdx: Set<number>; spans: Map<string, HeldMessageView[]> }>();
  for (const { m, i } of held) {
    for (const f of m.sensitive ?? []) {
      let cat = byCat.get(f.category);
      if (!cat) { cat = { msgIdx: new Set(), spans: new Map() }; byCat.set(f.category, cat); }
      cat.msgIdx.add(i);
      let sp = cat.spans.get(f.span);
      if (!sp) { sp = []; cat.spans.set(f.span, sp); }
      sp.push({ index: i, sender: m.sender, sentAt: m.sentAt, body: m.body });
    }
  }
  const groups: CategoryGroup[] = [...byCat.entries()].map(([category, c]) => ({
    category,
    count: c.msgIdx.size,
    spans: [...c.spans.entries()].map(([span, msgs]) => ({ span, count: msgs.length, messages: msgs })),
  }));
  return { held: held.length, groups };
}

/** Select which held messages to restore: one by index, or all matching a category (optionally a span). */
export type RestoreSelector = { index: number } | { category: string; span?: string };

export interface RestoreResult {
  messages: ImportedMessage[];
  restored: number; // how many messages were un-held
  /** The flags cleared, one per (category, span) on each restored message — the aggregate restore signal. */
  signals: Array<{ category: string; span: string }>;
}

/**
 * Restore the selected HELD messages: return a NEW messages array with their excluded flipped to false,
 * the count restored, and the flags cleared (for the signal). Only affects messages that are actually
 * held — restoring a clean or already-restored message is a no-op. Never mutates the input.
 */
export function restoreFlags(messages: ImportedMessage[], sel: RestoreSelector): RestoreResult {
  const signals: Array<{ category: string; span: string }> = [];
  let restored = 0;
  const out = messages.map((m, i) => {
    if (m.excluded !== true) return m;
    const match = 'index' in sel
      ? i === sel.index
      : (m.sensitive ?? []).some((f) => f.category === sel.category && (sel.span === undefined || f.span === sel.span));
    if (!match) return m;
    restored++;
    for (const f of m.sensitive ?? []) signals.push({ category: f.category, span: f.span });
    return { ...m, excluded: false };
  });
  return { messages: out, restored, signals };
}
