import { useState } from 'react';
import type { CaptureOutcome, RecallAnswer } from './recallClient.js';
import { ReceiptThread } from '../receipts/ReceiptThread.js';
import type { Receipt as AskReceipt } from './recallClient.js';

/** [P35-3] An Ask receipt → the shared chat receipt's reference. */
const refOf = (r: AskReceipt, sender?: string) => ({ noteId: r.noteId || null, clientId: r.clientId || null, span: r.span ?? null, at: r.at ?? r.date, quote: r.quote, sender: sender ?? null });

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
/** [AUDIT item 5] Map the backend's distinct 402 reason to the action the rep should take. */
function pausedMessage(reason?: string): string {
  switch (reason) {
    case 'allowance_exhausted':
      return "You've used this month's AI allowance, so Ask is paused. Top up with Buy more usage in Settings → Subscription, or wait for it to reset.";
    case 'ai_paused':
    case 'account_suspended':
    case 'subscription_ended':
      return 'Payment failed, so AI is paused. Update your card in Billing, then ask again.';
    default: // payment_required (trial lapsed / not subscribed)
      return 'Your plan has ended. Subscribe in Billing to use Ask.';
  }
}

/** [P35-1] "3 clients have open requirements:" with the count ("3 clients") in bold. */
function CountHeadline({ text }: { text: string }): JSX.Element {
  const m = /\d[\d,]*\s+clients?/.exec(text);
  if (!m) return <>{text}</>;
  return <>{text.slice(0, m.index)}<strong>{m[0]}</strong>{text.slice(m.index + m[0].length)}</>;
}

/** [P35-2] The server's honest not-found reply. */
const NOT_FOUND = "I don't have that on record.";
const notFound = (r: RecallAnswer): boolean => r.answer.trim() === NOT_FOUND;

export function Ask({ api, listen, onOpenSubscription }: { api: RecallApi; listen?: () => Promise<string>; /** [P37] the allowance refusal links to Subscription */ onOpenSubscription?: () => void }): JSX.Element {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<RecallAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overAllowance, setOverAllowance] = useState(false);
  const [capture, setCapture] = useState<CaptureOutcome | null>(null);
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);
  const [showNear, setShowNear] = useState(false); // [P35-2] near-misses stay collapsed until asked for

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setCapture(null);
    setCaptureMsg(null);
    setShowNear(false);
    const r = await api.ask(question);
    setBusy(false);
    if (!r) {
      setError('Something went wrong — please try again.');
      return;
    }
    if (r.paused) {
      // [AUDIT item 5] Point the rep at the RIGHT action for the reason the backend returned — a card
      // problem and a used-up allowance are different fixes, and showing one generic lock loses the sale.
      setError(pausedMessage(r.pausedReason));
      setOverAllowance(r.pausedReason === 'allowance_exhausted');
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
      {error && overAllowance && onOpenSubscription && <button type="button" className="tov-link" onClick={onOpenSubscription}>Buy more usage</button>}

      {/* [ASK-CAPTURE] a statement the rep made → confirm it into the vault, showing their own
          verbatim words (the receipt), not a paraphrase. Nothing is stored until they confirm. */}
      {/* [P21-A3] An explicit statement ("Remember that …") — one line, one tap: what was held, then Confirm. */}
      {capture?.status === 'captured' && capture.summary && (
        <div className="tov-deal" role="group" aria-label="Saved for confirmation" style={{ marginTop: '1rem' }}>
          <p style={{ margin: '0 0 0.5rem' }}>Saved for confirmation: {capture.summary}</p>
          {capture.statement && <p className="tov-stamp" style={{ margin: '0 0 0.5rem' }}>“{capture.statement}”</p>}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="tov-primary" onClick={() => void resolveCapture('confirm')}>Confirm</button>
            <button className="tov-link" onClick={() => void resolveCapture('reject')}>Not now</button>
          </div>
        </div>
      )}
      {capture?.status === 'captured' && !capture.summary && (
        <div className="tov-deal" role="group" aria-label="Add to record" style={{ marginTop: '1rem' }}>
          <div className="tov-stamp" style={{ marginBottom: 4 }}>Add to {capture.clientName ?? 'their'} record?</div>
          <p style={{ margin: '0 0 0.5rem' }}>“{capture.statement}”</p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="tov-primary" onClick={() => void resolveCapture('confirm')}>Confirm</button>
            <button className="tov-link" onClick={() => void resolveCapture('reject')}>Not now</button>
          </div>
        </div>
      )}
      {capture?.status === 'needs_client' && !capture.candidates && (
        <p role="status" style={{ color: 'var(--text-secondary)', marginTop: '0.75rem' }}>
          That sounds worth saving — name the client and I&rsquo;ll add it to their record.
        </p>
      )}
      {captureMsg && <p role="status" style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>{captureMsg}</p>}

      {/* [P21-A3] the held-statement card already says what was saved — don't repeat it as an answer. */}
      {result && !(result.capture?.status === 'captured' && result.capture.summary && result.receipts.length === 0) && (
        <div className="tov-deal" style={{ marginTop: '1rem' }}>
          {/* §7: the label states provenance ("on record"), not "answer". [P35-2] never above a not-found answer. */}
          {result.receipts.length > 0 && !notFound(result) && <div className="tov-stamp" style={{ marginBottom: 4 }}>On record</div>}
          {/* [P18-5] The answer is already plain text (markdown stripped server-side); pre-wrap keeps
              any line breaks (e.g. a bulleted list) without rendering literal markup. */}
          {result.list ? (
            <>
              {/* [P35-1] the count first (bold), then one line per client, each with its own receipt */}
              <p data-testid="answer" style={{ margin: '0 0 0.5rem' }}><CountHeadline text={result.list.headline} /></p>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {result.list.items.map((item) => (
                  <div key={item.clientId} data-testid="list-line">
                    <div><strong>{item.clientName}</strong>{item.line ? `: ${item.line}` : ''}</div>
                    {item.receipts[0] && <ReceiptThread refInfo={refOf(item.receipts[0], item.clientName)} />}
                  </div>
                ))}
              </div>
              {result.list.more > 0 && <p style={{ color: 'var(--text-secondary)' }}>…and {result.list.more} more.</p>}
            </>
          ) : (
            <p data-testid="answer" style={{ whiteSpace: 'pre-wrap' }}>{result.answer}</p>
          )}
          {/* [P35-2] near-misses only behind a collapsed link — never under "Receipts" */}
          {notFound(result) && (result.nearMisses?.length ?? 0) > 0 && (
            <div style={{ marginTop: '0.5rem' }}>
              <button type="button" className="tov-link" aria-expanded={showNear} onClick={() => setShowNear((v) => !v)}>Closest messages I found</button>
              {showNear && (
                <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
                  {result.nearMisses!.map((r, i) => <ReceiptThread key={i} refInfo={refOf(r)} />)}
                </div>
              )}
            </div>
          )}
          {result.receipts.length > 0 && !notFound(result) && !result.list && (
            <div>
              <strong>Receipts</strong>
              <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
                {result.receipts.map((r, i) => (
                  <ReceiptThread key={i} refInfo={refOf(r)} compact={false} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
