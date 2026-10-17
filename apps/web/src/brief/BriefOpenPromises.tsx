import { Receipt } from '../components/Receipt.js';
import { formatBody } from '../format/dates.js';
import type { FactReceipt } from '../clients/clientsClient.js';

export interface BriefPromise {
  id: string;
  text: string;
  dueDate: string | null;
  dueRaw: string | null;
  receipt?: FactReceipt;
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
          <li key={p.id} style={{ padding: '4px 0' }}>
            <span>
              {p.text}
              {p.dueDate ? ` (due ${formatBody(p.dueDate)})` : p.dueRaw ? ` (${p.dueRaw})` : ''}
            </span>
            {p.receipt?.quote && <Receipt quote={p.receipt.quote} date={p.receipt.at ?? undefined} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
