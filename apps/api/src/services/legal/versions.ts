/**
 * [BETA-2c] The single source of truth for legal-document versions. Every stored acceptance record
 * points at one of these identifiers, and the reconcile guard (versions.test.ts) fails the build if a
 * published page's rendered version drifts from the constant here — so an acceptance can always be
 * resolved to the exact wording the person saw (see legal-archive/ for the frozen text of each version).
 *
 * Identifiers are date-based ISO (YYYY-MM-DD) = the date that document's wording last changed. Bump a
 * constant ONLY when its document actually changes, and snapshot the outgoing text into legal-archive/
 * first (see legal-archive/README.md). This supersedes the former auth-service CONSENT_POLICY_VERSION —
 * one source of truth, not three.
 */

/** Terms of Service version. Derivation: matches "Last updated: 22 September 2026" on the published
 *  Terms page (apps/web/terms/index.html) — the last time the Terms wording changed. The reconcile
 *  guard proves the page and this constant agree. (The former CONSENT_POLICY_VERSION was '2026-08-01',
 *  a pre-publication DRAFT stamp; accounts that recorded it keep it — an accurate record of the draft
 *  text they saw, archived under legal-archive/2026-08-01/.) */
export const TERMS_VERSION = '2026-09-22';

/** Privacy Policy version. Derivation: matches "Last updated: 22 September 2026" on the published
 *  Privacy page (apps/web/privacy/index.html). Tracked separately from TERMS so the two can diverge
 *  when only one document changes; today they are the same date. */
export const PRIVACY_VERSION = '2026-09-22';

/** Version of the access-request confirmation checkbox wording (BETA-3). Derivation: the date that
 *  exact confirmation sentence was fixed — authored in this batch, 2026-10-01. It is NOT terms
 *  acceptance; it is stored against access_requests.confirmation_text_version so we can later prove
 *  which wording a submitter was shown. Bump only if the confirmation sentence itself changes. */
export const CONFIRMATION_TEXT_VERSION = '2026-10-01';
