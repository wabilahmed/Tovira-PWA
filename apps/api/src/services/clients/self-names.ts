import type { NoteRecord } from '../../ports/note-repository.js';
import { normalizeName } from '../text/normalize-name.js';

/**
 * [P36-5] Every name the CLIENT goes by in their own record — their client name, the name they write under in
 * the chat (client-role senders), and learned aliases — normalised. A person with one of these names is the
 * client, never one of "the people around the deal" (stakeholder map, brief People).
 */
export function clientSelfNames(clientName: string, notes: Array<Pick<NoteRecord, 'messages'>>, aliases: string[] = []): Set<string> {
  return new Set([
    clientName,
    ...notes.flatMap((n) => (n.messages ?? []).filter((m) => m.role === 'client').map((m) => m.sender)),
    ...aliases,
  ].map(normalizeName).filter(Boolean));
}

/** True when `name` is one of the client's own names. */
export function isTheClient(name: string | null | undefined, selfNames: Set<string>): boolean {
  return !!name && selfNames.has(normalizeName(name));
}
