import { hapticTick } from '../haptics.js';
import { useState } from 'react';
import type { ImportResult } from '../clients/clientsClient.js';
import { CeilingNotice } from './CeilingNotice.js';
import { RepIdentification } from './RepIdentification.js';
import { formatBody, formatRange } from '../format/dates.js';
import { ExportSteps } from '../onboarding/exportSteps.js';

export interface ImportApi {
  importWhatsApp(clientId: string, input: string | { content?: string; contentBase64?: string; misfileAck?: boolean; firstImportAck?: boolean; confirmImport?: boolean; counterpart?: string }, consent: boolean): Promise<ImportResult>;
}

/** [P20-6] The mismatch copy, built on the web so dates go through the SHARED formatter (never ISO):
 *  with a suggested client → "This chat looks like it's with {who} ({N} messages · {date|range}), not
 *  {client}."; with no suggestion → the short "This chat looks like it's with {who}, not {client}." */
export function mismatchCopy(m: {
  who: string; clientName: string; hasSuggestion: boolean; messageCount?: number; dateFrom?: string | null; dateTo?: string | null;
}): string {
  if (!m.hasSuggestion) return `This chat looks like it's with ${m.who}, not ${m.clientName}.`;
  const dateBit = m.dateFrom ? (m.dateFrom === m.dateTo ? formatBody(m.dateFrom) : formatRange(m.dateFrom, m.dateTo ?? m.dateFrom)) : '';
  const count = m.messageCount ?? 0;
  const inner = [`${count} message${count === 1 ? '' : 's'}`, dateBit].filter(Boolean).join(' · ');
  return `This chat looks like it's with ${m.who} (${inner}), not ${m.clientName}.`;
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
  onOpenClient,
  initialContent = '',
  initialContentBase64 = '',
  onOpenSubscription,
}: {
  clientId: string;
  api: ImportApi;
  onImported: (count: number) => void;
  /** [P20-6] Open a client by id — used by the "Imported to X · Open" toast after filing to the
   *  suggested client. Absent → the toast shows without an Open action. */
  onOpenClient?: (clientId: string) => void;
  /** Prefill text (e.g. a chat shared as text via the Android share-target). */
  initialContent?: string;
  /** Prefill file bytes (e.g. a .zip shared via the Android share-target). */
  initialContentBase64?: string;
  /** [P37] Over the allowance → "Buy more usage" opens Settings → Subscription. */
  onOpenSubscription?: () => void;
}): JSX.Element {
  const [content, setContent] = useState(initialContent);
  const [fileB64, setFileB64] = useState(initialContentBase64);
  const [fileName, setFileName] = useState(initialContentBase64 ? 'shared chat' : '');
  // [P16-2] The REAL upload file name (for the "WhatsApp Chat with X" title) — distinct from the display
  // label above. Empty for a shared/pasted chat (no real name), so we never send a placeholder as a title.
  const [uploadName, setUploadName] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ceilingCount, setCeilingCount] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overAllowance, setOverAllowance] = useState(false); // [P37] the refusal was the AI allowance

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
        setUploadName(file.name || ''); // the real name (for the title); '' if the browser gave none
      }
    };
    reader.readAsArrayBuffer(file);
  }

  const [misfile, setMisfile] = useState<{ message: string; suggestion: { id: string; name: string } | null; needsRepIdentification: boolean; participants: string[]; counterpart: string | null; clientName?: string; messageCount?: number; dateFrom?: string | null; dateTo?: string | null } | null>(null);
  // [P20-6] After "Import to X" (to the suggested client), a toast "Imported to X · Open".
  const [importedTo, setImportedTo] = useState<{ id: string; name: string } | null>(null);
  // [AUDIT gap B] A two-speaker first import asks which speaker is the client; the rep picks it here.
  const [repChoice, setRepChoice] = useState<string | null>(null);
  // [AUDIT gap A] First-ever import: the server asks the rep to acknowledge their right to upload.
  const [firstAck, setFirstAck] = useState<string | null>(null);

  // [P14-4c] targetClientId lets the rep file the chat under the client it actually matches (the misfile
  // suggestion), not only the one on screen. Defaults to the open client.
  async function doImport(ack: boolean, firstImportAck = false, confirm?: { counterpart: string }, targetClientId: string = clientId, targetClientName?: string): Promise<void> {
    setBusy(true);
    setError(null);
    setCeilingCount(null);
    setNotice(null);
    setImportedTo(null);
    setFirstAck(null); // [IMP-09/13] once this attempt resolves (incl. to an error), the right-to-upload prompt clears
    // Only attach optional acks when set, so the common payload shape stays { content, misfileAck }.
    const meta: { misfileAck: boolean; firstImportAck?: boolean; confirmImport?: boolean; counterpart?: string; fileName?: string } = { misfileAck: ack };
    if (firstImportAck) meta.firstImportAck = true;
    if (confirm) { meta.confirmImport = true; meta.counterpart = confirm.counterpart; } // [AUDIT gap B] rep-id confirm
    // [P16-2] Send the real export file name so the server can read its "WhatsApp Chat with X" title (the
    // authoritative misfile signal). Only a selected file has one — a pasted/shared chat sends nothing.
    if (uploadName) meta.fileName = uploadName;
    const payload = fileB64 ? { contentBase64: fileB64, ...meta } : { content, ...meta };
    const result = await api.importWhatsApp(targetClientId, payload, consent);
    setBusy(false);
    if (result.ok) {
      hapticTick(); // the chat is saved — a genuine commit
      setContent('');
      setFileB64('');
      setFileName('');
      setUploadName('');
      setConsent(false);
      setMisfile(null);
      setRepChoice(null);
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
      // [P20-6] Filed to the SUGGESTED client (a different one than on screen) → confirmation toast.
      if (targetClientName && targetClientId !== clientId) setImportedTo({ id: targetClientId, name: targetClientName });
      onImported(result.imported);
    } else if (result.error === 'misfile') {
      // MISFILE-DETECT: confirm, never block. Show the suggestion; the rep continues anyway or
      // files under the right client from the client screen. We never auto-reassign.
      setMisfile({ message: result.message, suggestion: result.suggestion, needsRepIdentification: result.needsRepIdentification ?? false, participants: result.participants ?? [], counterpart: result.counterpart ?? null, clientName: result.clientName, messageCount: result.messageCount, dateFrom: result.dateFrom ?? null, dateTo: result.dateTo ?? null });
    } else if (result.error === 'ack_required') {
      // [AUDIT gap A] First import — show the right-to-upload notice and let the rep proceed, instead
      // of the old generic "Import failed." (the 428 body carries `notice`, not `message`).
      setFirstAck(result.message);
    } else {
      setError(result.message);
      setOverAllowance(result.error === 'allowance');
    }
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    await doImport(false);
  }

  return (
    <form onSubmit={submit} aria-label="Import WhatsApp chat" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {/* [P37] the shared export steps for the rep's own phone */}
      <ExportSteps />
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Then choose the file here (.zip or .txt), or paste the chat.</p>

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

      <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={consent}
          aria-label="Consent to import"
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>I understand this export contains the whole conversation, and I have consent to store it.</span>
      </label>

      {error && <p role="alert" style={{ color: 'var(--claret)', margin: 0 }}>{error}</p>}
      {error && overAllowance && onOpenSubscription && (
        <button type="button" className="tov-link" style={{ justifySelf: 'start' }} onClick={onOpenSubscription}>Buy more usage</button>
      )}
      {notice && <p role="status" style={{ color: 'var(--text-secondary)', margin: 0 }}>{notice}</p>}
      {/* [P20-6] "Imported to X · Open" after filing to the suggested client (same toast as move Undo). */}
      {importedTo && (
        <div role="status" data-testid="import-toast" className="lead-toast">
          <span>Imported to {importedTo.name}</span>
          {onOpenClient && <button type="button" onClick={() => onOpenClient(importedTo.id)}>Open</button>}
        </div>
      )}
      {ceilingCount !== null && <CeilingNotice imported={ceilingCount} />}

      {firstAck && (
        // [AUDIT gap A] First-ever import acknowledgement. Declining changes nothing; confirming
        // re-sends with firstImportAck so the import proceeds.
        <div role="alert" style={{ border: '1px solid var(--hairline)', borderRadius: '0.5rem', padding: 'var(--space-3)', display: 'grid', gap: 'var(--space-2)' }}>
          <span>{firstAck}</span>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" onClick={() => void doImport(false, true)} disabled={busy}>
              {busy ? 'Importing…' : 'I have the right to upload this — continue'}
            </button>
            <button type="button" onClick={() => setFirstAck(null)} disabled={busy}>Not now</button>
          </div>
        </div>
      )}

      {misfile?.needsRepIdentification ? (
        // [AUDIT gap B] Two-speaker first import: the rep says which speaker is the client (the other is
        // them). Reuses the bulk-import rep-identification control, then re-imports with the confirmed
        // counterpart so the server learns the rep's name + the client alias and proceeds.
        <div role="group" aria-label="Who is this chat with" style={{ border: '1px solid var(--hairline)', borderRadius: '0.5rem', padding: 'var(--space-3)', display: 'grid', gap: 'var(--space-2)' }}>
          <span>{misfile.message}</span>
          <RepIdentification legend="Which name is the client?" candidates={misfile.participants} value={repChoice} onChange={setRepChoice} />
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" onClick={() => repChoice && void doImport(false, false, { counterpart: repChoice })} disabled={busy || !repChoice}>
              {busy ? 'Importing…' : 'Continue'}
            </button>
            <button type="button" onClick={() => { setMisfile(null); setRepChoice(null); setFileB64(''); setFileName(''); setContent(''); }} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : misfile ? (
        // Confirm, never block. The rep continues here, or cancels and files it under the right
        // client from the clients screen. Tovira never moves it on its own.
        <div role="alert" style={{ border: '1px solid var(--claret)', borderRadius: '0.5rem', padding: 'var(--space-3)', display: 'grid', gap: 'var(--space-2)' }}>
          {/* [P20-6] Build the copy from parts with the shared date formatter (never ISO); fall back to
              the server message only if the parts are missing (old payload). */}
          <span>{misfile.clientName
            ? mismatchCopy({ who: misfile.counterpart ?? misfile.participants[0] ?? 'this contact', clientName: misfile.clientName, hasSuggestion: !!misfile.suggestion, messageCount: misfile.messageCount, dateFrom: misfile.dateFrom, dateTo: misfile.dateTo })
            : misfile.message}</span>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {/* [P14-4c] When the chat matches ANOTHER existing client, offer to file it THERE — the right
                place — not only "here anyway". This re-imports to the matched client's id. */}
            {misfile.suggestion && (
              <button type="button" onClick={() => misfile.suggestion && void doImport(true, false, undefined, misfile.suggestion.id, misfile.suggestion.name)} disabled={busy}>
                {busy ? 'Importing…' : `Import to ${misfile.suggestion.name}`}
              </button>
            )}
            <button type="button" onClick={() => void doImport(true)} disabled={busy}>
              {busy ? 'Importing…' : 'Import here anyway'}
            </button>
            <button type="button" onClick={() => { setMisfile(null); setFileB64(''); setFileName(''); setContent(''); }} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <button type="submit" disabled={!canSubmit}>
        {busy ? 'Importing…' : 'Import chat'}
      </button>
    </form>
  );
}
