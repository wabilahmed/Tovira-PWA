import { normalizeName } from '../text/normalize-name.js';

/** Whether a client is a person or an organisation. Not recorded in the schema yet → callers pass null. */
export type ClientType = 'individual' | 'company';

/**
 * [P36-5 · owner, 20 Oct] The names that mark a person as the CLIENT in their own record (stakeholder map, brief
 * People): always the client's own name; their learned aliases ONLY when the client is an individual (then the
 * alias is the same person). For a company client, a person whose name is an alias is a real stakeholder (Marina
 * Estates → Khalid) and is never hidden. Unknown type → don't guess: aliases hide no one. The chat's client-side
 * senders are never treated as the client.
 */
export function clientSelfNames(clientName: string, aliases: string[] = [], clientType: ClientType | null | undefined = null): Set<string> {
  return new Set([clientName, ...(clientType === 'individual' ? aliases : [])].map(normalizeName).filter(Boolean));
}

/** True when `name` is one of the client's own names. */
export function isTheClient(name: string | null | undefined, selfNames: Set<string>): boolean {
  return !!name && selfNames.has(normalizeName(name));
}
