import { useState } from 'react';

/**
 * [PRIVACY-6] A suggested one-line disclosure the rep can copy into a WhatsApp Business profile or a
 * first message, so the people they talk to know an AI assistant keeps notes. Single source of truth
 * for the wording; there is deliberately NO tracking of whether the rep used it — that would be
 * surveillance of the rep.
 *
 * [PLACEHOLDER WORDING — owner to finalise before the policy is published.]
 */
export const DISCLOSURE_LINE = 'I use an AI assistant to keep notes on our conversations.';

export function DisclosureLine(): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard?.writeText(DISCLOSURE_LINE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the rep can still select + copy the text manually */
    }
  }

  return (
    <section aria-labelledby="disclosure-h" style={{ marginTop: '1.5rem' }}>
      <h3 id="disclosure-h" style={{ margin: '0 0 0.25rem' }}>Tell clients you keep notes</h3>
      <p style={{ color: 'var(--text-secondary)', margin: '0 0 0.6rem' }}>
        A one-line disclosure to paste into your WhatsApp Business profile or a first message.
      </p>
      <blockquote data-testid="disclosure-text" style={{ margin: '0 0 0.6rem', paddingLeft: '0.75rem', borderLeft: '2px solid var(--hairline)' }}>
        {DISCLOSURE_LINE}
      </blockquote>
      <button type="button" className="tov-chit-action" onClick={() => void copy()} aria-label="Copy the disclosure line">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </section>
  );
}
