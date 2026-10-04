import { useState, useRef, useEffect } from 'react';
import { ImportReview, type ReviewResult, type ReviewRow, type ReviewDecision, type Upsell } from './ImportReview.js';
import { BulkImportResult, type BulkJob } from './BulkImportResult.js';
import type { BulkImportApi } from './bulkImportClient.js';

/**
 * [BULK-IMPORT page] The end-to-end flow: pick up to 20 chat exports (.txt/.zip) → upload one per request
 * → review (with the top-up/subscribe upsell when the batch exceeds the allowance) → Import → a live
 * progress/result view that polls the batch status. Mobile-first (one column, works at 375px).
 */
export const BULK_MAX_FILES = 20;
/** Per-file upload ceiling. [FIX 1] Files upload as RAW BINARY (no base64/JSON inflation), so the cap is
 *  the server's MAX_IMPORT_UPLOAD_BYTES = 2 × MAX_IMPORT_CHARS (10 MB) — a full long-history export fits.
 *  Kept in sync with the server constant. Oversized files show a "too large" row and are never uploaded,
 *  so they can't fail the batch. */
export const BULK_MAX_UPLOAD_BYTES = 10_000_000;

type Step = 'pick' | 'uploading' | 'review' | 'ack' | 'progress';

export function BulkImport({ api, pollMs = 400 }: { api: BulkImportApi; pollMs?: number }): JSX.Element {
  const [step, setStep] = useState<Step>('pick');
  const [overCap, setOverCap] = useState<File[] | null>(null); // selection > 20, awaiting confirm
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState('');
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [upsell, setUpsell] = useState<Upsell | undefined>(undefined);
  const [pendingDecisions, setPendingDecisions] = useState<ReviewDecision[]>([]);
  const [jobs, setJobs] = useState<BulkJob[]>([]);
  const [resultUpsell, setResultUpsell] = useState<Upsell | undefined>(undefined);
  const [done, setDone] = useState(false);

  // [FIX 2b] If the rep leaves the review (or ack) without importing, delete the staged upload — the
  // batch holds third-party chat content. Best-effort on unmount; the 24h sweep is the backstop.
  const batchIdRef = useRef('');
  const importStartedRef = useRef(false);
  batchIdRef.current = batchId;
  useEffect(() => () => {
    if (batchIdRef.current && !importStartedRef.current) void api.abandon(batchIdRef.current);
  }, [api]);

  function onPick(list: FileList | null): void {
    setError(null);
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    if (files.length > BULK_MAX_FILES) { setOverCap(files); return; } // ask before dropping extras
    void startBatch(files);
  }

  async function startBatch(files: File[]): Promise<void> {
    setOverCap(null);
    setStep('uploading');
    const id = (globalThis.crypto?.randomUUID?.() ?? `b${Date.now()}`);
    setBatchId(id);
    const tooLargeRows: ReviewRow[] = [];
    try {
      let index = 0;
      for (const file of files) {
        if (file.size > BULK_MAX_UPLOAD_BYTES) { // client-side size gate → its own row, never uploaded
          tooLargeRows.push({ fileName: file.name, platform: null, state: 'too_large', counterpart: null });
          continue;
        }
        const buf = new Uint8Array(await file.arrayBuffer());
        const up = await api.uploadFile(id, index, file.name, buf);
        if (up.tooLarge) tooLargeRows.push({ fileName: file.name, platform: null, state: 'too_large', counterpart: null });
        index += 1;
      }
      const parsed = await api.parse(id);
      // Oversized rows (never uploaded) are shown alongside the parsed rows, excluded from import.
      setResult({ ...parsed.result, rows: [...parsed.result.rows, ...tooLargeRows] });
      setUpsell(parsed.upsell);
      setStep('review');
    } catch {
      setError('Something went wrong reading those files. Try again.');
      setStep('pick');
    }
  }

  async function doImport(decisions: ReviewDecision[], firstImportAck?: boolean): Promise<void> {
    setPendingDecisions(decisions);
    const r = await api.startImport(batchId, decisions, firstImportAck);
    if (r.needAck) { setStep('ack'); return; }
    if (!r.started) { setError('Import could not start. Try again.'); return; }
    importStartedRef.current = true; // the server now owns cleanup of the staged files
    setStep('progress');
    void poll();
  }

  async function poll(): Promise<void> {
    for (;;) {
      const s = await api.status(batchId);
      setJobs(s.jobs);
      if (s.done) { setResultUpsell(s.upsell); setDone(true); return; }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  if (step === 'pick') {
    return (
      <section aria-label="Import chats" data-testid="bulk-import" style={{ display: 'grid', gap: '0.75rem', maxWidth: 480 }}>
        <h2 style={{ margin: 0 }}>Import chats</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Export your chats from WhatsApp (Without media) and select up to {BULK_MAX_FILES} at once.</p>
        <label>
          <span style={{ display: 'block', marginBottom: '0.25rem' }}>Choose chat exports (.txt or .zip)</span>
          <input type="file" multiple accept=".txt,.zip,text/plain,application/zip" aria-label="Choose chat exports" onChange={(e) => onPick(e.target.files)} />
        </label>
        {overCap && (
          <div role="alert" data-testid="over-cap" style={{ display: 'grid', gap: '0.5rem' }}>
            <p style={{ margin: 0 }}>You chose {overCap.length} files. You can import up to {BULK_MAX_FILES} at a time — we’ll keep the first {BULK_MAX_FILES}.</p>
            <button type="button" onClick={() => void startBatch(overCap.slice(0, BULK_MAX_FILES))}>Import the first {BULK_MAX_FILES}</button>
          </div>
        )}
        {error && <p role="alert" style={{ color: 'var(--claret, #a23)', margin: 0 }}>{error}</p>}
      </section>
    );
  }

  if (step === 'uploading') {
    return <section aria-label="Import chats" data-testid="bulk-import"><p role="status">Uploading and reading your chats…</p></section>;
  }

  if (step === 'review' && result) {
    return (
      <section aria-label="Import chats" data-testid="bulk-import">
        <ImportReview result={result} upsell={upsell} onImport={(d) => void doImport(d)} onTopUp={() => {}} onSubscribe={() => {}} />
      </section>
    );
  }

  if (step === 'ack') {
    return (
      <section aria-label="Import chats" data-testid="bulk-import" style={{ display: 'grid', gap: '0.5rem' }}>
        <p>These chats were written by other people. Confirm you have the right to upload them.</p>
        <button type="button" onClick={() => void doImport(pendingDecisions, true)}>I have the right to upload these</button>
      </section>
    );
  }

  // progress + result: one row per chat, polled live; the result upsell appears once done.
  return (
    <section aria-label="Import chats" data-testid="bulk-import">
      {!done && <p role="status" data-testid="import-progress">Importing your chats…</p>}
      <BulkImportResult jobs={jobs} upsell={done ? resultUpsell : undefined} onTopUp={() => {}} onSubscribe={() => {}} />
    </section>
  );
}
