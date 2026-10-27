import type { ContactAliasRepository } from '../../ports/contact-alias-repository.js';

/** [P49-3] What extraction gets for a client: a learned alias as a plain string (it folds an extracted person into the
 *  client on a shared word, as before) and a previous name, the one a rename replaced, marked to fold on the exact full
 *  name only. */
export type ExtractionAlias = string | { previousName: string };

export function extractionAliasesFor(aliases: Pick<ContactAliasRepository, 'listByClientWithKind'>): (userId: string, clientId: string) => Promise<ExtractionAlias[]> {
  return async (userId, clientId) => (await aliases.listByClientWithKind(userId, clientId)).map((a) => (a.kind === 'previous_name' ? { previousName: a.alias } : a.alias));
}
