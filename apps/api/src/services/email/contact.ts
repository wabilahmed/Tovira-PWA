/** [D9] The single public contact address. Every transactional email sets Reply-To here, and the legal
 *  pages, marketing site and in-app copy all use it. The From identity comes ONLY from EMAIL_FROM (target:
 *  hello@tovira.io) — see emailConfigSummary / the [email] boot log line for what live actually uses. */
export const CONTACT_EMAIL = 'hello@tovira.io';

/** [P58-1 · owner] The founder's own address: the hot-lead beta invite comes from it, and replies go to it. Every other
 *  email keeps EMAIL_FROM and CONTACT_EMAIL. The display name is quoted because it contains a comma. */
export const FOUNDER_EMAIL = 'wabil@tovira.io';
export const FOUNDER_FROM = `"Wabil Ahmed, Tovira" <${FOUNDER_EMAIL}>`;

/** [P58-1] A per-message From / Reply-To must be on our own domain (tovira.io, never another); throws otherwise. */
export function assertOwnSender(addr: string | undefined): void {
  if (addr === undefined) return;
  const email = (/<([^>]+)>\s*$/.exec(addr)?.[1] ?? addr).trim().toLowerCase();
  if (!/^[^@\s]+@tovira\.io$/.test(email)) throw new Error(`a per-message sender must be on our own domain (tovira.io): ${email}`);
}
