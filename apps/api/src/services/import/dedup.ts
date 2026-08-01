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
