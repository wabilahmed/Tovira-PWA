import { useState } from 'react';
import type { RecallAnswer } from './recallClient.js';
import { Receipt } from '../components/Receipt.js';

export interface RecallApi {
  ask(question: string): Promise<RecallAnswer | null>;
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

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const r = await api.ask(question);
    setBusy(false);
    if (!r) {
      setError('Something went wrong — please try again.');
      return;
    }
    setResult(r);
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
          placeholder='e.g. "What did Ahmed say about pricing?"'
          aria-label="Your question"
          style={{ flex: 1 }}
        />
        {listen && <button type="button" onClick={() => void speak()} aria-label="Ask by voice">Voice</button>}
        <button type="submit" disabled={busy || !question.trim()}>{busy ? 'Thinking…' : 'Ask'}</button>
      </form>

      {error && <p role="alert" style={{ color: 'var(--claret)' }}>{error}</p>}

      {result && (
        <div style={{ marginTop: '1rem' }}>
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
