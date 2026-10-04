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
  close: 'To close the sale:',
  next_opportunity: 'Next opportunity:',
  retrospective: 'What we think went wrong:',
};

export function PointersCard({ clientName, pointers, disclosure }: {
  clientName: string;
  pointers: Pointer[];
  disclosure: string | null;
}): JSX.Element {
  const relationship = pointers.filter((p) => p.section === 'relationship');
  const second = pointers.filter((p) => p.section !== 'relationship');
  const secondSection = second[0]?.section as Exclude<Pointer['section'], 'relationship'> | undefined;

  return (
    <section aria-label="Pointers for your next meeting" data-testid="pointers-card" style={{ display: 'grid', gap: '0.75rem' }}>
      <p style={{ margin: 0, fontWeight: 600 }}>In your next meeting with {clientName}, keep these in mind.</p>
      {pointers.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>This chat is short, so only a couple of things stood out.</p>
      ) : (
        <>
          {relationship.length > 0 && <PointerGroup heading="To build the relationship:" pointers={relationship} />}
          {secondSection && <PointerGroup heading={SECOND_HEADING[secondSection]} pointers={second} />}
          {disclosure && <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--text-secondary)' }}>{disclosure}</p>}
        </>
      )}
    </section>
  );
}

function PointerGroup({ heading, pointers }: { heading: string; pointers: Pointer[] }): JSX.Element {
  return (
    <div>
      <div className="tov-stamp">{heading}</div>
      <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem' }}>
        {pointers.map((p, i) => (
          <li key={i}>
            {p.text}
            {p.inferred && <span style={{ color: 'var(--text-secondary)' }}> (our read)</span>}
            {p.receipts.length > 0 && (
              <details style={{ marginTop: '0.15rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85em' }}>why</summary>
                <ul style={{ margin: '0.15rem 0 0', paddingLeft: '1rem' }}>
                  {p.receipts.map((r, j) => (
                    <li key={j} style={{ color: 'var(--text-secondary)', fontSize: '0.85em' }}>&ldquo;{r.source_span}&rdquo;{r.source_message_at ? ` — ${r.source_message_at}` : ''}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
