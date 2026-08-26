/**
 * Branded HTML wrapper for transactional email — the Ledger look from
 * docs/tovira-brand.md (warm paper, terracotta accent, a serif display face),
 * built email-client-safe: a table layout with inline styles only, and web-safe
 * fonts (Fraunces isn't available in mail clients, so Georgia stands in for the
 * display face). Plain text stays the source of truth; this is the pretty layer.
 */

export interface EmailButton {
  label: string;
  url: string;
}

export interface EmailContent {
  heading: string;
  /** Body paragraphs shown before the button. */
  intro: string[];
  /** Optional call-to-action button (e.g. a reset/confirm link). */
  button?: EmailButton;
  /** Body paragraphs shown after the button. */
  outro?: string[];
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const paras = (arr: string[] | undefined): string =>
  (arr ?? [])
    .map((p) => `<p style="margin:0 0 16px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3a352f;">${escapeHtml(p)}</p>`)
    .join('');

/** The plain-text body for a piece of content (source of truth), sign-off added by the caller. */
export function renderText(c: EmailContent): string {
  const parts = [...c.intro];
  if (c.button) parts.push(`${c.button.label}:\n${c.button.url}`);
  if (c.outro && c.outro.length) parts.push(...c.outro);
  return parts.join('\n\n');
}

/** The branded HTML body. */
export function renderEmail(c: EmailContent): string {
  const button = c.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;"><tr><td style="border-radius:8px;background:#d14821;">
             <a href="${escapeAttr(c.button.url)}" style="display:inline-block;padding:12px 26px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(c.button.label)}</a>
           </td></tr></table>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:#f4f1ea;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
        <tr><td style="padding:0 4px 18px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:600;letter-spacing:-0.01em;color:#1c1917;">
          <span style="color:#d14821;">T</span>o<span style="color:#d14821;">v</span>ira
        </td></tr>
        <tr><td style="background:#faf7ef;border:1px solid #d6cfbd;border-radius:12px;padding:28px 28px 22px;">
          <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:600;line-height:1.28;color:#1c1917;">${escapeHtml(c.heading)}</h1>
          ${paras(c.intro)}
          ${button}
          ${paras(c.outro)}
          <p style="margin:22px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#6b645d;">— Tovira</p>
        </td></tr>
        <tr><td style="padding:16px 8px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#8b847a;">
          Your deal, our memory, instant success.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
