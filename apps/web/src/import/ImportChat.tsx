import { hapticTick } from '../haptics.js';
import { useState } from 'react';
import type { ImportResult } from '../clients/clientsClient.js';
import { CeilingNotice } from './CeilingNotice.js';

export interface ImportApi {
  importWhatsApp(clientId: string, input: string | { content?: string; contentBase64?: string; misfileAck?: boolean; firstImportAck?: boolean }, consent: boolean): Promise<ImportResult>;
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

  const [misfile, setMisfile] = useState<{ message: string; suggestion: { id: string; name: string } | null } | null>(null);
  // [AUDIT gap A] First-ever import: the server asks the rep to acknowledge their right to upload.
  const [firstAck, setFirstAck] = useState<string | null>(null);

  async function doImport(ack: boolean, firstImportAck = false): Promise<void> {
    setBusy(true);
    setError(null);
    setCeilingCount(null);
    setNotice(null);
    // Only attach firstImportAck when set, so the common payload shape stays { content, misfileAck }.
    const meta: { misfileAck: boolean; firstImportAck?: boolean } = { misfileAck: ack };
    if (firstImportAck) meta.firstImportAck = true;
    const payload = fileB64 ? { contentBase64: fileB64, ...meta } : { content, ...meta };
    const result = await api.importWhatsApp(clientId, payload, consent);
    setBusy(false);
    if (result.ok) {
      hapticTick(); // the chat is saved — a genuine commit
      setContent('');
      setFileB64('');
      setFileName('');
      setConsent(false);
      setMisfile(null);
      setFirstAck(null);
      // A fully-overlapping re-import is a correct no-op, not a failure — say so
      // calmly so the rep keeps re-exporting (that's what keeps the bank fed).
      if (result.duplicate) setNotice("Already up to date — no new messages in that export.");
      // [FOLLOW-UP 2] A very long chat was cut to its most recent part — tell the rep on the result.
      else if (result.truncated) setNotice('Very long chat: only the most recent part was imported.');
      // The import succeeded and the chat is saved. If the trial ceiling stopped
      // the scan, show the reassuring notice here too (the timeline shows it per
      // note). Either way the timeline refreshes via onImported.
      else if (result.ceilingReached) setCeilingCount(result.imported);
      onImported(result.imported);
    } else if (result.error === 'misfile') {
      // MISFILE-DETECT: confirm, never block. Show the suggestion; the rep continues anyway or
      // files under the right client from the client screen. We never auto-reassign.
      setMisfile({ message: result.message, suggestion: result.suggestion });
    } else if (result.error === 'ack_required') {
      // [AUDIT gap A] First import — show the right-to-upload notice and let the rep proceed, instead
      // of the old generic "Import failed." (the 428 body carries `notice`, not `message`).
      setFirstAck(result.message);
    } else {
      setError(result.message);
    }
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    await doImport(false);
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

      {firstAck && (
        // [AUDIT gap A] First-ever import acknowledgement. Declining changes nothing; confirming
        // re-sends with firstImportAck so the import proceeds.
        <div role="alert" style={{ border: '1px solid var(--hairline)', borderRadius: '0.5rem', padding: '0.75rem', display: 'grid', gap: '0.5rem' }}>
          <span>{firstAck}</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" onClick={() => void doImport(false, true)} disabled={busy}>
              {busy ? 'Importing…' : 'I have the right to upload this — continue'}
            </button>
            <button type="button" onClick={() => setFirstAck(null)} disabled={busy}>Not now</button>
          </div>
        </div>
      )}

      {misfile && (
        // Confirm, never block. The rep continues here, or cancels and files it under the right
        // client from the clients screen. Tovira never moves it on its own.
        <div role="alert" style={{ border: '1px solid var(--claret)', borderRadius: '0.5rem', padding: '0.75rem', display: 'grid', gap: '0.5rem' }}>
          <span>{misfile.message}</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" onClick={() => void doImport(true)} disabled={busy}>
              {busy ? 'Importing…' : 'Import here anyway'}
            </button>
            <button type="button" onClick={() => { setMisfile(null); setFileB64(''); setFileName(''); setContent(''); }} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <button type="submit" disabled={!canSubmit}>
        {busy ? 'Importing…' : 'Import chat'}
      </button>
    </form>
  );
}
