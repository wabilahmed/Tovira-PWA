import { ReceiptThread } from '../receipts/ReceiptThread.js';
import { formatBody } from '../format/dates.js';
import type { FactReceipt } from '../clients/clientsClient.js';
import { aiText } from '../format/aiText.js';

export interface BriefPromise {
  id: string;
  text: string;
  dueDate: string | null;
  dueRaw: string | null;
  receipt?: FactReceipt;
  /** [P35-3] Sent with the brief (the stored promise row) — resolved to the source chat bubble. */
  noteId?: string;
  clientId?: string;
  sourceSpan?: string | null;
  sourceMessageAt?: string | null;
}

/**
 * [P18-10b / FEAT-02] The brief's open-promises section. Each promise shows its RECEIPT — the verbatim
 * quote + date it was drawn from — the same trust signature the rest of the product carries. A promise
 * that predates receipts (no stored quote) simply shows no chit; we never fabricate one.
 */
export function BriefOpenPromises({ promises }: { promises: BriefPromise[] }): JSX.Element | null {
  if (promises.length === 0) return null;
  return (
    <div>
      <div className="tov-stamp">Open promises</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {promises.map((p) => (
          <li key={p.id} style={{ padding: 'var(--space-1) 0' }}>
            <span>
              {aiText(p.text)}
              {p.dueDate ? ` (due ${formatBody(p.dueDate)})` : p.dueRaw ? ` (${p.dueRaw})` : ''}
            </span>
            {p.receipt?.quote && (
              <ReceiptThread compact={false} refInfo={{ noteId: p.noteId ?? null, clientId: p.clientId ?? null, span: p.sourceSpan ?? p.receipt.quote, at: p.sourceMessageAt ?? p.receipt.at, quote: p.receipt.quote, sender: p.receipt.source === 'capture' ? 'Your note' : null }} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
