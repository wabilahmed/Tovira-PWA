/** [D9] The single public contact address. Every transactional email sets Reply-To here, and the legal
 *  pages, marketing site and in-app copy all use it. The From identity comes ONLY from EMAIL_FROM (target:
 *  hello@tovira.io) — see emailConfigSummary / the [email] boot log line for what live actually uses. */
export const CONTACT_EMAIL = 'hello@tovira.io';
