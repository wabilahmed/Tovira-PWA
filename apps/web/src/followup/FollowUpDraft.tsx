import { useState } from 'react';
import { whatsappLink } from '../whatsapp/waLink.js';

export interface FollowUpApi {
  draftFollowUp(noteId: string): Promise<string | null>;
}

/** Draft an editable follow-up from a note (P4-4) and, with one tap, open
 *  WhatsApp with it pre-filled (P4-7). Tovira NEVER sends — the rep reviews,
 *  edits, and taps send inside WhatsApp. */
export function FollowUpDraft({
  noteId,
  api,
  phone,
  openLink = (url) => window.open(url, '_blank', 'noopener'),
}: {
  noteId: string;
  api: FollowUpApi;
  phone?: string;
  openLink?: (url: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function makeDraft(): Promise<void> {
    setBusy(true);
    setError(null);
    setCopied(false);
    const text = await api.draftFollowUp(noteId);
    setBusy(false);
    if (text == null) {
      setError('Could not draft a follow-up — try again.');
      return;
    }
    setDraft(text);
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard?.writeText(draft ?? '');
      setCopied(true);
    } catch {
      /* clipboard unavailable — the rep can still select + copy manually */
    }
  }

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <button onClick={() => void makeDraft()} disabled={busy}>
        {busy ? 'Drafting…' : 'Draft follow-up'}
      </button>
      {error && <p role="alert" style={{ color: 'var(--claret)' }}>{error}</p>}
      {draft != null && (
        <div style={{ marginTop: '0.5rem' }}>
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setCopied(false); }}
            aria-label="Follow-up draft"
            rows={5}
            style={{ width: '100%' }}
          />
          <button onClick={() => void copy()}>{copied ? 'Copied ✓' : 'Copy'}</button>{' '}
          <button className="tov-primary" onClick={() => openLink(whatsappLink(draft, phone))}>Send via WhatsApp</button>
        </div>
      )}
    </div>
  );
}
