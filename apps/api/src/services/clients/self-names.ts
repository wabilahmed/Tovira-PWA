import { normalizeName } from '../text/normalize-name.js';

/**
 * [P36-5] Every name the CLIENT goes by in their own record — their client name and their learned aliases —
 * normalised. A person with one of these names is the client, never one of "the people around the deal"
 * (stakeholder map, brief People). The chat's client-side SENDERS are deliberately not included: for a company
 * client ("Marina Estates") the person writing is a real stakeholder (Khalid, the decision-maker).
 */
export function clientSelfNames(clientName: string, aliases: string[] = []): Set<string> {
  return new Set([clientName, ...aliases].map(normalizeName).filter(Boolean));
}

/** True when `name` is one of the client's own names. */
export function isTheClient(name: string | null | undefined, selfNames: Set<string>): boolean {
  return !!name && selfNames.has(normalizeName(name));
}
