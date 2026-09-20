/**
 * [TRIAL-FARM] Normalise an email into the key used to dedupe TRIAL GRANTS, so the same real inbox
 * cannot claim multiple fresh 14-day trials. This affects ONLY the trial-grant key — the account's
 * login email is stored verbatim (the real address).
 *
 * Two provider-standard aliasing tricks route to the same inbox and must collapse to one key:
 *   - Plus-addressing (`wabil+1@`, `wabil+anything@`) — supported by Gmail, Outlook, Fastmail, etc.
 *     The tag after `+` is stripped for ALL providers (universally an alias, never a distinct inbox).
 *   - Gmail dots (`w.a.b.i.l@gmail.com` === `wabil@gmail.com`) and the googlemail.com alias —
 *     dot-insensitivity is Gmail-specific, so dots are stripped ONLY for gmail.com / googlemail.com,
 *     and googlemail.com is canonicalised to gmail.com.
 *
 * Conservative: for every other domain the local part is left intact apart from the plus-tag, so two
 * genuinely different mailboxes are never wrongly merged.
 */
export function normalizeTrialEmailKey(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return trimmed; // no domain — nothing safe to normalise beyond trim/lowercase
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);

  // Plus-addressing: everything from the first '+' in the local part is an alias tag.
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);

  // Gmail: dots in the local part are ignored, and googlemail.com is the same as gmail.com.
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }

  return `${local}@${domain}`;
}
