import { matchName, mentionsName, normName } from './name-match.js';
import { isActiveErasure, type ErasureRequestRepository } from '../../ports/erasure-request-repository.js';

/**
 * [TASK 2] Processing restriction during an erasure review window.
 *
 * From the moment a third-party erasure request is received until it is completed/rejected/withdrawn,
 * everything in that request's scope is RESTRICTED: it is never sent to any model and never surfaced
 * (briefs, answers, the daily list, pointers, search, alerts). It is NOT deleted — it stays stored and
 * stays in the rep's export, and in their book it shows as a placeholder rather than the content. The
 * scope is the same name-based "about" family the erasure itself reaches (name-match.ts).
 *
 * Restriction is DERIVED, never persisted per record: it is simply the union of the requester names of
 * every still-active request for a rep. So a new message that arrives during the window is restricted
 * the instant it is read (its sender matches), and the restriction lifts automatically the moment the
 * request leaves the active states — nothing to migrate or unwind.
 *
 * SCOPE CHOICE: we restrict on `matchName !== 'none'` — exact AND fuzzy (a shared whole word) — i.e. the
 * superset the erasure could reach once fuzzy candidates are confirmed. The window's purpose is to PAUSE
 * processing of the disputed data while it is reviewed, and restriction is temporary and reversible, so
 * the cautious superset is the right default (a wrong disclosure is worse than a withheld one).
 */
export interface Restriction {
  /** Any active request → true. The fast path everywhere: `if (!restriction.active) return asIs`. */
  readonly active: boolean;
  /** Is this structured who-field value (a name/subject/sender) within a restricted scope? */
  restrictsWho(who: string | null | undefined): boolean;
  /** Does this free text cite a restricted counterparty? (pointers, glossary terms.) */
  restrictsText(text: string | null | undefined): boolean;
}

/** The no-op restriction — nothing active, nothing withheld. Shared singleton for the common case. */
export const NO_RESTRICTION: Restriction = {
  active: false,
  restrictsWho: () => false,
  restrictsText: () => false,
};

/** Build a Restriction from a set of restricted counterparty names (already the active set). */
export function restrictionForNames(names: string[]): Restriction {
  const norm = [...new Set(names.map(normName).filter((n) => n.length > 0))];
  if (norm.length === 0) return NO_RESTRICTION;
  return {
    active: true,
    restrictsWho: (who) => matchName(who, norm) !== 'none',
    restrictsText: (text) => mentionsName(text, norm),
  };
}

/**
 * Loads the active restriction for a rep from their erasure requests. Injected into every surfacing path
 * so the withholding is computed in exactly one place.
 */
export class RestrictionService {
  constructor(private readonly deps: { requests: Pick<ErasureRequestRepository, 'listByUser'> }) {}

  async forUser(userId: string): Promise<Restriction> {
    const reqs = await this.deps.requests.listByUser(userId);
    const names = reqs.filter((r) => isActiveErasure(r.status)).flatMap((r) => r.requesterNames);
    return restrictionForNames(names);
  }
}
