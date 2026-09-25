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
 * [SCREEN-REVIEW] Bulk restore is offered only for a group of BULK_THRESHOLD or more messages.
 * DERIVATION: bulk exists to clear a large dominant false-positive token in ONE action (the "party ×12",
 * hundred-item case). On a small group, individual restore — with the matched-sentence preview already
 * in front of the rep — is a couple of taps and keeps every decision explicit. Offering bulk on a group
 * of three buys nothing and trains the exact habit this surface must not build: clearing groups without
 * reading, which would turn the legal control into a Clear-All button. 10 is the point where tapping each
 * becomes tedious enough to push a rep toward unread bulk-clearing, so a bulk affordance — shown only
 * with the previews visible — is warranted. Below 10: individual restores only.
 */
const BULK_THRESHOLD = 10;

/** Render a message body with every (case-insensitive) occurrence of the matched span highlighted. */
function Highlighted({ text, span }: { text: string; span: string }): JSX.Element {
  if (!span) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = span.toLowerCase();
  let i = 0;
  let k = 0;
  for (;;) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) { parts.push(text.slice(i)); break; }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(<mark key={k++} data-testid="match">{text.slice(idx, idx + span.length)}</mark>);
    i = idx + span.length;
  }
  return <>{parts}</>;
}

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
          {g.count >= BULK_THRESHOLD && (
            <button type="button" disabled={busy} data-testid={`category-restore-${g.category}`} onClick={() => void restore({ category: g.category })} style={btn}>
              Restore all {labelOf(g.category)} ({g.count})
            </button>
          )}

          {g.spans.map((s) => (
            <div key={s.span} data-testid={`flag-span-${g.category}-${s.span}`} style={{ marginTop: '0.6rem', paddingLeft: '0.5rem', borderLeft: '2px solid var(--rule)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                <span>“{s.span}” · {s.count}</span>
              </div>
              {/* Previews first — the rep reads the matched sentences BEFORE any bulk action. */}
              {s.messages.map((m) => (
                <div key={m.index} style={{ marginTop: '0.4rem' }}>
                  <p style={{ margin: '0.2rem 0' }}><span style={{ color: 'var(--text-secondary)' }}>{m.sender}:</span> <Highlighted text={m.body} span={s.span} /></p>
                  <button type="button" disabled={busy} data-testid={`msg-restore-${m.index}`} onClick={() => void restore({ index: m.index })} style={{ ...btn, marginTop: '0.15rem' }}>
                    Restore this message
                  </button>
                </div>
              ))}
              {/* Bulk only for a large dominant-token group (see BULK_THRESHOLD), and only after the
                  previews above are on screen — so it is an informed clear, not a gamble on a word. */}
              {s.count >= BULK_THRESHOLD && (
                <button type="button" disabled={busy} data-testid={`span-restore-${g.category}-${s.span}`} onClick={() => void restore({ category: g.category, span: s.span })} style={{ ...btn, marginTop: '0.5rem' }}>
                  Restore all {s.count} “{s.span}”
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
