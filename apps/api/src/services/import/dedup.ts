/**
 * Message-level dedup for chat re-imports (P3-7). Re-exporting a chat overlaps
 * the previous export; we store overlapping messages once and extract only the
 * new tail, so a re-import is idempotent (identical file → nothing new).
 */
import type { ImportedMessage } from '../../ports/note-repository.js';

/** Stable identity: a message is the same if time + sender + body match. */
function messageKey(m: ImportedMessage): string {
  return `${m.sentAt ?? ''}${m.sender}${m.body}`;
}

/** The incoming messages that aren't already present in `existing`, in order. */
export function dedupeMessages(existing: ImportedMessage[], incoming: ImportedMessage[]): ImportedMessage[] {
  const seen = new Set(existing.map(messageKey));
  const out: ImportedMessage[] = [];
  for (const m of incoming) {
    const key = messageKey(m);
    if (seen.has(key)) continue;
    seen.add(key); // also dedupe within the incoming batch
    out.push(m);
  }
  return out;
}

/** Render messages back into a readable thread for extraction. */
export function renderThread(messages: ImportedMessage[]): string {
  return messages.map((m) => `[${m.sentAt ?? ''}] ${m.sender}: ${m.body}`).join('\n');
}

/**
 * [SCREEN] The text that is safe to send to ANY model — the thread with excluded (flagged, un-restored)
 * messages removed. Every model send (extraction payload, embedding, recall excerpt, draft, brief query)
 * routes through this, so a flagged message is held from all of them by a single chokepoint. For a note
 * with no structured message array (paste, voice, Ask capture — the rep's OWN words, not third-party
 * chat), there is nothing to exclude per-message, so the stored rawText is returned unchanged.
 */
export function modelSafeText(note: { messages?: ImportedMessage[] | null; rawText?: string | null }): string {
  if (note.messages && note.messages.length > 0) return renderThread(note.messages.filter((m) => !m.excluded));
  return note.rawText ?? '';
}
