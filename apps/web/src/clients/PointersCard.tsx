import { humanizeIsoDates } from '../format/dates.js';
import { ReceiptThread } from '../receipts/ReceiptThread.js';

/**
 * [POINTERS · D8/D9] The pointers card — shown in the client thread after a chat import and in the
 * pre-meeting brief. Renders the exact template: a relationship section, then one deal-state-dependent
 * section, and (for a confirmed loss) the retrospective disclosure. An inferred pointer is marked; each
 * pointer's receipts (the message spans it came from) are tappable so the rep can see the exchange.
 */
export interface PointerReceipt { source_span: string; source_message_at: string | null }
export interface Pointer {
  section: 'relationship' | 'close' | 'next_opportunity' | 'retrospective';
  text: string;
  receipts: PointerReceipt[];
  inferred?: boolean;
}

const SECOND_HEADING: Record<Exclude<Pointer['section'], 'relationship'>, string> = {
  close: 'Closing the sale',
  next_opportunity: 'Next opportunity:',
  retrospective: 'What we think went wrong:',
};

export function PointersCard({ clientName, clientId, pointers, disclosure }: {
  clientName: string;
  /** [P35-3] Whose chats the "why" receipts come from. */
  clientId?: string;
  pointers: Pointer[];
  disclosure: string | null;
}): JSX.Element {
  const relationship = pointers.filter((p) => p.section === 'relationship');
  const second = pointers.filter((p) => p.section !== 'relationship');
  const secondSection = second[0]?.section as Exclude<Pointer['section'], 'relationship'> | undefined;

  return (
    <section aria-label="Pointers for your next meeting" data-testid="pointers-card" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <p style={{ margin: 0, fontWeight: 600 }}>In your next meeting with {clientName}, keep these in mind.</p>
      {pointers.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>This chat is short, so only a couple of things stood out.</p>
      ) : (
        <>
          {relationship.length > 0 && <PointerGroup heading="Building the relationship" pointers={relationship} clientId={clientId} />}
          {secondSection && <PointerGroup heading={SECOND_HEADING[secondSection]} pointers={second} clientId={clientId} />}
          {disclosure && <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--text-secondary)' }}>{disclosure}</p>}
        </>
      )}
    </section>
  );
}

function PointerGroup({ heading, pointers, clientId }: { heading: string; pointers: Pointer[]; clientId?: string }): JSX.Element {
  return (
    <div>
      <div className="tov-stamp">{heading}</div>
      <ul style={{ margin: 'var(--space-1) 0 0', paddingLeft: 'var(--space-4)' }}>
        {pointers.map((p, i) => (
          <li key={i}>
            {humanizeIsoDates(p.text) /* [P21-D] "(for 2026-04-06)" → "(for 6 Apr 2026)" */}
            {/* [P36-5] an inferred pointer is labelled as Tovira's read, not a stated fact */}
            {p.inferred && <span className="tov-read" style={{ color: 'var(--text-secondary)' }}> · Tovira's read</span>}
            {p.receipts.length > 0 && (
              <details style={{ marginTop: 'var(--space-1)' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 'var(--text-secondary-size)' }}>why</summary>
                {/* [P35-3] each "why" as the chat it came from */}
                <div style={{ display: 'grid', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
                  {p.receipts.map((r, j) => (
                    <ReceiptThread key={j} compact={false} refInfo={{ clientId: clientId ?? null, span: r.source_span, at: r.source_message_at, quote: r.source_span }} />
                  ))}
                </div>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
