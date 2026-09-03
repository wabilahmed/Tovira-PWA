import { useState } from 'react';
import type { CaptureOutcome, RecallAnswer } from './recallClient.js';
import { Receipt } from '../components/Receipt.js';

export interface RecallApi {
  ask(question: string): Promise<RecallAnswer | null>;
  confirmCapture?(noteId: string): Promise<boolean>;
  rejectCapture?(noteId: string): Promise<boolean>;
}

/**
 * Conversational recall (P4-8): ask your memory a question. The answer always
 * carries its receipts (quote + date); nothing on record → an honest "I don't
 * have that". Optional voice: a `listen` prop (browser speech) fills the box.
 */
export function Ask({ api, listen }: { api: RecallApi; listen?: () => Promise<string> }): JSX.Element {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<RecallAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capture, setCapture] = useState<CaptureOutcome | null>(null);
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setCapture(null);
    setCaptureMsg(null);
    const r = await api.ask(question);
    setBusy(false);
    if (!r) {
      setError('Something went wrong — please try again.');
      return;
    }
    setResult(r);
    if (r.capture && r.capture.status !== 'none') setCapture(r.capture);
  }

  // [ASK-CAPTURE] confirmation is required — a query surface never silently mutates the vault.
  async function resolveCapture(action: 'confirm' | 'reject'): Promise<void> {
    if (!capture?.noteId) return;
    const ok = action === 'confirm' ? await api.confirmCapture?.(capture.noteId) : await api.rejectCapture?.(capture.noteId);
    setCaptureMsg(action === 'confirm' && ok ? `Added to ${capture.clientName ?? 'their'} record.` : 'Left as it was.');
    setCapture(null);
  }

  async function speak(): Promise<void> {
    if (!listen) return;
    const heard = await listen();
    if (heard.trim()) setQuestion(heard);
  }

  return (
    <section aria-label="Ask your memory">
      <h2 style={{ marginTop: 0 }}>Ask your memory</h2>
      <form onSubmit={submit} style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask your book…"
          aria-label="Your question"
          style={{ flex: 1 }}
        />
        {listen && <button type="button" onClick={() => void speak()} aria-label="Ask by voice">Voice</button>}
        <button type="submit" disabled={busy || !question.trim()}>{busy ? 'Thinking…' : 'Ask'}</button>
      </form>

      {error && <p role="alert" style={{ color: 'var(--claret)' }}>{error}</p>}

      {/* [ASK-CAPTURE] a statement the rep made → confirm it into the vault, showing their own
          verbatim words (the receipt), not a paraphrase. Nothing is stored until they confirm. */}
      {capture?.status === 'captured' && (
        <div className="tov-deal" role="group" aria-label="Add to record" style={{ marginTop: '1rem' }}>
          <div className="tov-stamp" style={{ marginBottom: 4 }}>Add to {capture.clientName ?? 'their'} record?</div>
          <p style={{ margin: '0 0 0.5rem' }}>“{capture.statement}”</p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="tov-primary" onClick={() => void resolveCapture('confirm')}>Confirm</button>
            <button className="tov-link" onClick={() => void resolveCapture('reject')}>Not now</button>
          </div>
        </div>
      )}
      {capture?.status === 'needs_client' && (
        <p role="status" style={{ color: 'var(--text-secondary)', marginTop: '0.75rem' }}>
          That sounds worth saving — name the client and I&rsquo;ll add it to their record.
        </p>
      )}
      {captureMsg && <p role="status" style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>{captureMsg}</p>}

      {result && (
        <div className="tov-deal" style={{ marginTop: '1rem' }}>
          {/* §7: the label states provenance ("on record"), not "answer". */}
          {result.receipts.length > 0 && <div className="tov-stamp" style={{ marginBottom: 4 }}>On record</div>}
          <p data-testid="answer">{result.answer}</p>
          {result.receipts.length > 0 && (
            <div>
              <strong>Receipts</strong>
              <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
                {result.receipts.map((r, i) => (
                  <Receipt key={i} quote={r.quote} date={r.date} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
