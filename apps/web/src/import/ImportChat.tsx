import { hapticTick } from '../haptics.js';
import { useState } from 'react';
import type { ImportResult } from '../clients/clientsClient.js';
import { CeilingNotice } from './CeilingNotice.js';

export interface ImportApi {
  importWhatsApp(clientId: string, input: string | { content?: string; contentBase64?: string }, consent: boolean): Promise<ImportResult>;
}

/** Base64-encode raw file bytes in chunks (spreading a whole Uint8Array into fromCharCode
 *  overflows the call stack on a real export). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * WhatsApp chat-export import (P1-4b / P5-3 / IMPORT-ZIP). Reps share or upload the export from
 * WhatsApp's "Export Chat" (a .zip on iOS, a .txt on Android) or paste it. The file is read as raw
 * BYTES and sent base64 — never `readAsText`, which corrupts a zip — and the server detects the
 * format by content. Consent is required (a full export is the whole conversation), so the button
 * stays disabled until it's confirmed.
 */
export function ImportChat({
  clientId,
  api,
  onImported,
  initialContent = '',
  initialContentBase64 = '',
}: {
  clientId: string;
  api: ImportApi;
  onImported: (count: number) => void;
  /** Prefill text (e.g. a chat shared as text via the Android share-target). */
  initialContent?: string;
  /** Prefill file bytes (e.g. a .zip shared via the Android share-target). */
  initialContentBase64?: string;
}): JSX.Element {
  const [content, setContent] = useState(initialContent);
  const [fileB64, setFileB64] = useState(initialContentBase64);
  const [fileName, setFileName] = useState(initialContentBase64 ? 'shared chat' : '');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ceilingCount, setCeilingCount] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A selected/shared file takes precedence over the paste box.
  const canSubmit = (fileB64.length > 0 || content.trim().length > 0) && consent && !busy;

  function onFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    // Read BYTES, not text — a .zip must survive intact. The server validates by content.
    reader.onload = () => {
      const buf = reader.result;
      if (buf instanceof ArrayBuffer) {
        setFileB64(bytesToBase64(new Uint8Array(buf)));
        setFileName(file.name || 'chat export');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setCeilingCount(null);
    setNotice(null);
    const result = await api.importWhatsApp(clientId, fileB64 ? { contentBase64: fileB64 } : { content }, consent);
    setBusy(false);
    if (result.ok) {
      hapticTick(); // the chat is saved — a genuine commit
      setContent('');
      setFileB64('');
      setFileName('');
      setConsent(false);
      // A fully-overlapping re-import is a correct no-op, not a failure — say so
      // calmly so the rep keeps re-exporting (that's what keeps the bank fed).
      if (result.duplicate) setNotice("Already up to date — no new messages in that export.");
      // The import succeeded and the chat is saved. If the trial ceiling stopped
      // the scan, show the reassuring notice here too (the timeline shows it per
      // note). Either way the timeline refreshes via onImported.
      else if (result.ceilingReached) setCeilingCount(result.imported);
      onImported(result.imported);
    } else {
      setError(result.message);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Import WhatsApp chat" style={{ display: 'grid', gap: '0.75rem' }}>
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
        In WhatsApp, open the chat, choose Export Chat, then <strong>Without Media</strong>. On iPhone this gives a
        .zip; on Android a .txt. Share it into Tovira, or upload the file here. Tovira accepts either.
      </p>

      <label>
        Chat export (.zip or .txt)
        <input
          type="file"
          accept="text/plain,application/zip,application/x-zip-compressed,application/octet-stream,.txt,.zip"
          aria-label="Chat export file"
          onChange={onFile}
        />
      </label>
      {fileName && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Selected: {fileName}</p>}

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

      {error && <p role="alert" style={{ color: 'var(--claret)', margin: 0 }}>{error}</p>}
      {notice && <p role="status" style={{ color: 'var(--text-secondary)', margin: 0 }}>{notice}</p>}
      {ceilingCount !== null && <CeilingNotice imported={ceilingCount} />}

      <button type="submit" disabled={!canSubmit}>
        {busy ? 'Importing…' : 'Import chat'}
      </button>
    </form>
  );
}
