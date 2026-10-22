import { useState, useRef, useEffect } from 'react';
import { ImportReview, type ReviewResult, type ReviewRow, type ReviewDecision, type Upsell } from './ImportReview.js';
import { BulkImportResult, type BulkJob } from './BulkImportResult.js';
import type { BulkImportApi } from './bulkImportClient.js';
import type { Plan } from '../billing/plans.js';
import { ExportSteps } from '../onboarding/exportSteps.js';
import { Banner, Button, FileButton, formatSize } from '../ui/index.js';

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

export function BulkImport({ api, pollMs = 400, onSubscribe, onOpenBookScan, single = false, onClientReady, onOpenSubscription, title }: {
  api: BulkImportApi; pollMs?: number; onSubscribe?: (plan: Plan) => void; onOpenBookScan?: () => void;
  /** [P39] A heading, only where no PageHeader already names the screen (the first-run guide). */
  title?: string;
  /** [P36-1] "New client from a chat": one export → one client (the same deterministic parse + review). */
  single?: boolean;
  /** [P37] "Buy more usage" opens Settings → Subscription. */
  onOpenSubscription?: () => void;
  /** [P36-1] Called with the client a chat was filed under as soon as its import starts — the rep then
   *  lands on that client's page with the import running. */
  onClientReady?: (clientId: string) => void;
}): JSX.Element {
  const [step, setStep] = useState<Step>('pick');
  const [chosen, setChosen] = useState<Array<{ name: string; size: number }>>([]);
  const [overCap, setOverCap] = useState<File[] | null>(null); // selection > 20, awaiting confirm
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState('');
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [upsell, setUpsell] = useState<Upsell | undefined>(undefined);
  const [pendingDecisions, setPendingDecisions] = useState<ReviewDecision[]>([]);
  const [jobs, setJobs] = useState<BulkJob[]>([]);
  const [resultUpsell, setResultUpsell] = useState<Upsell | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [summary, setSummary] = useState<{ chatsImported: number; promises: number; requirements: number } | undefined>(undefined);

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
    setChosen(files.map((f) => ({ name: f.name, size: f.size })));
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
      const ready = onClientReady ? Object.values(s.started ?? {})[0]?.clientId : undefined;
      if (ready) { onClientReady!(ready); return; }
      setJobs(s.jobs);
      if (s.done) { setResultUpsell(s.upsell); setSummary(s.summary); setDone(true); return; }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  if (step === 'pick') {
    return (
      <section aria-label="Import chats" data-testid="bulk-import" className="ui-stack ui-gap-4">
        {title && <h2 className="ui-section-title">{title}</h2>}
        {/* [P39 · owner] The intro, word for word; the export steps as iPhone | Android tabs in a card. */}
        <p className="ui-body">
          {single
            ? "Export the chat from WhatsApp and choose it here. You confirm who it's with before anything is read."
            : `Export your chats from WhatsApp and choose up to ${BULK_MAX_FILES} at once.`}
        </p>
        <ExportSteps />
        {/* [P18-10i] ".zip or .txt" — same order as the not_whatsapp error. [P39] A styled file button, never the
            browser's "Choose file / No file chosen"; the chosen file's name and size show under it. */}
        <FileButton
          label={single ? 'Choose the chat export (.zip or .txt)' : 'Choose chat exports (.zip or .txt)'}
          accept=".txt,.zip,text/plain,application/zip"
          multiple={!single}
          chosen={chosen}
          onFiles={onPick}
        />
        {overCap && (
          <Banner tone="warning" data-testid="over-cap" actions={<Button onClick={() => void startBatch(overCap.slice(0, BULK_MAX_FILES))}>Import the first {BULK_MAX_FILES}</Button>}>
            You chose {overCap.length} files. You can import up to {BULK_MAX_FILES} at a time. We'll keep the first {BULK_MAX_FILES}.
          </Banner>
        )}
        {error && <p role="alert" className="ui-secondary ui-danger">{error}</p>}
      </section>
    );
  }

  if (step === 'uploading') {
    return (
      <section aria-label="Import chats" data-testid="bulk-import" className="ui-stack ui-gap-3">
        {chosen.length > 0 && <p className="ui-secondary" data-testid="file-chosen">{chosen.map((f) => `${f.name} · ${formatSize(f.size)}`).join(', ')}</p>}
        <p role="status" className="ui-body">{chosen.length === 1 ? 'Reading the chat…' : 'Uploading and reading your chats…'}</p>
      </section>
    );
  }

  if (step === 'review' && result) {
    return (
      <section aria-label="Import chats" data-testid="bulk-import">
        <ImportReview result={result} upsell={upsell} onImport={(d) => void doImport(d)} onOpenSubscription={onOpenSubscription} onSubscribe={onSubscribe} />
      </section>
    );
  }

  if (step === 'ack') {
    return (
      <section aria-label="Import chats" data-testid="bulk-import" style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <p>These chats were written by other people. Confirm you have the right to upload them.</p>
        <button type="button" onClick={() => void doImport(pendingDecisions, true)}>I have the right to upload these</button>
      </section>
    );
  }

  // progress + result: one row per chat, polled live; the result upsell appears once done.
  return (
    <section aria-label="Import chats" data-testid="bulk-import">
      {!done && <p role="status" data-testid="import-progress">Importing your chats…</p>}
      <BulkImportResult jobs={jobs} upsell={done ? resultUpsell : undefined} onOpenSubscription={onOpenSubscription} onSubscribe={onSubscribe} summary={done ? summary : undefined} onOpenBookScan={onOpenBookScan} />
    </section>
  );
}
