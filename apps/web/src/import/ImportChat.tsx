import { useState } from 'react';
import type { ImportResult } from '../clients/clientsClient.js';

export interface ImportApi {
  importWhatsApp(clientId: string, content: string, consent: boolean): Promise<ImportResult>;
}

/**
 * WhatsApp chat-export import (P1-4b / P5-3). Reps upload the .txt from WhatsApp's
 * "Export Chat" (or paste it). Consent is required — a full export contains the
 * whole conversation — so the button stays disabled until it's confirmed.
 */
export function ImportChat({
  clientId,
  api,
  onImported,
}: {
  clientId: string;
  api: ImportApi;
  onImported: (count: number) => void;
}): JSX.Element {
  const [content, setContent] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = content.trim().length > 0 && consent && !busy;

  function onFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setContent(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const result = await api.importWhatsApp(clientId, content, consent);
    setBusy(false);
    if (result.ok) {
      setContent('');
      setConsent(false);
      onImported(result.imported);
    } else {
      setError(result.message);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Import WhatsApp chat" style={{ display: 'grid', gap: '0.75rem' }}>
      <p style={{ margin: 0, color: '#444' }}>
        In WhatsApp: open the chat → Export Chat → <strong>Without Media</strong> → share it here (or upload the .txt).
      </p>

      <label>
        Chat export (.txt)
        <input type="file" accept="text/plain,.txt" aria-label="Chat export file" onChange={onFile} />
      </label>

      <label>
        …or paste the exported chat
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          aria-label="Pasted chat export"
          rows={4}
          style={{ width: '100%' }}
        />
      </label>

      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={consent}
          aria-label="Consent to import"
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>I understand this export contains the whole conversation, and I have consent to store it.</span>
      </label>

      {error && <p role="alert" style={{ color: 'crimson', margin: 0 }}>{error}</p>}

      <button type="submit" disabled={!canSubmit}>
        {busy ? 'Importing…' : 'Import chat'}
      </button>
    </form>
  );
}
