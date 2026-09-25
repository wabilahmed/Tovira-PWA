import { useCallback, useEffect, useState } from 'react';
import type { ScreeningApi, FlagReviewData, RestoreSelector } from './screeningClient.js';
import { HeldNotice } from './HeldNotice.js';

/** Readable category labels; falls back to a de-underscored, capitalised form for anything new. */
const LABELS: Record<string, string> = {
  health: 'Health',
  religion: 'Religion',
  ethnicity: 'Ethnicity',
  political_opinion: 'Political opinion',
  criminal: 'Criminal matters',
  sexual_life: 'Sexual life',
};
const labelOf = (c: string): string => LABELS[c] ?? c.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase());

/**
 * [SCREEN-REVIEW] The flag-review surface. Held messages grouped category → matched span, with a bulk
 * restore at EACH level so a rep can clear a dominant false-positive token ("party", "court") in one
 * action, plus per-message restore. Restoring re-queues extraction (server-side) and refreshes the list.
 * Mobile-first: a single column, full-width tap targets. The list carries only the FIRST coverage
 * sentence (HeldNotice 'short'); the full not-exhaustive line lives at import completion and beside the scan.
 */
export function FlagReview({ noteId, api, onRestored }: { noteId: string; api: ScreeningApi; onRestored?: () => void }): JSX.Element | null {
  const [data, setData] = useState<FlagReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setData(await api.flags(noteId));
    setLoading(false);
  }, [api, noteId]);

  useEffect(() => { void load(); }, [load]);

  const restore = useCallback(async (sel: RestoreSelector) => {
    setBusy(true);
    const res = await api.restore(noteId, sel);
    if (res && res.restored > 0) onRestored?.();
    await load();
    setBusy(false);
  }, [api, noteId, load, onRestored]);

  if (loading) return <p data-testid="flag-review-loading">Loading held messages…</p>;
  if (!data || data.held === 0) return null; // nothing held → the review does not appear

  const btn: React.CSSProperties = { width: '100%', textAlign: 'left', padding: '0.6rem 0.75rem', marginTop: '0.35rem' };

  return (
    <section aria-label="Held messages for review" data-testid="flag-review">
      <header className="tov-screenhead">
        <div className="tov-stamp">Held for your review</div>
        <h2>{data.held} message{data.held === 1 ? '' : 's'} held before analysis</h2>
      </header>
      <HeldNotice variant="short" />

      {data.groups.map((g) => (
        <div key={g.category} data-testid={`flag-category-${g.category}`} style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
            <strong>{labelOf(g.category)}</strong>
            <span style={{ color: 'var(--text-secondary)' }}>{g.count}</span>
          </div>
          <button type="button" disabled={busy} data-testid={`category-restore-${g.category}`} onClick={() => void restore({ category: g.category })} style={btn}>
            Restore all {labelOf(g.category)}
          </button>

          {g.spans.map((s) => (
            <div key={s.span} data-testid={`flag-span-${g.category}-${s.span}`} style={{ marginTop: '0.6rem', paddingLeft: '0.5rem', borderLeft: '2px solid var(--rule)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                <span>“{s.span}” · {s.count}</span>
              </div>
              <button type="button" disabled={busy} data-testid={`span-restore-${g.category}-${s.span}`} onClick={() => void restore({ category: g.category, span: s.span })} style={btn}>
                Restore all “{s.span}”
              </button>
              {s.messages.map((m) => (
                <div key={m.index} style={{ marginTop: '0.4rem' }}>
                  <p style={{ margin: '0.2rem 0' }}><span style={{ color: 'var(--text-secondary)' }}>{m.sender}:</span> {m.body}</p>
                  <button type="button" disabled={busy} data-testid={`msg-restore-${m.index}`} onClick={() => void restore({ index: m.index })} style={{ ...btn, marginTop: '0.15rem' }}>
                    Restore this message
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
