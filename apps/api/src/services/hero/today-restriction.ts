import type { TodayAction } from './hero-service.js';
import type { NoteRepository } from '../../ports/note-repository.js';
import { factWithholder, type RestrictionSource } from '../erasure/surface-filter.js';

/**
 * [P47] Today's list is computed ahead (no model call, a cost guard), so a restriction opened after it was computed
 * is applied HERE, when the list is served:
 *  - an action read from the restricted person (its receipt is their message, or its wording names them) is dropped;
 *  - a going-quiet card stays (the client is still quiet: that is not their data) but loses the quote of their message.
 */
export async function withholdRestrictedActions(
  userId: string,
  actions: TodayAction[],
  restriction: RestrictionSource | undefined,
  notes: Pick<NoteRepository, 'listByClient'>,
  clientName: (clientId: string) => string | undefined,
): Promise<TodayAction[]> {
  if (!restriction) return actions;
  const r = await restriction.forUser(userId);
  if (!r.active) return actions;
  const withheld = await factWithholder(userId, restriction, notes, clientName);
  const out: TodayAction[] = [];
  for (const a of actions) {
    const words = [a.text, a.title, a.subline].filter((x): x is string => typeof x === 'string');
    const quoteWithheld = a.receipt?.quote ? await withheld({ clientId: a.clientId ?? '', noteId: a.receipt.noteId ?? null, quote: a.receipt.quote }) : false;
    if (a.kind === 'cold') {
      if (a.clientId && r.restrictsWho(clientName(a.clientId) ?? '')) continue; // the client is them
      // their message as the receipt → the card's usual last-contact form (the date only, no words)
      out.push(quoteWithheld && a.receipt ? { ...a, receipt: { quote: null, source: 'contact', at: a.receipt.at ? a.receipt.at.slice(0, 10) : null } } : a);
      continue;
    }
    if (quoteWithheld || words.some((w) => r.restrictsText(w))) continue;
    out.push(a);
  }
  return out;
}
