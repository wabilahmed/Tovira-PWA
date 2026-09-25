import { useCallback, useEffect, useState } from 'react';
import type { ScreeningApi, HeldNoteSummary } from './screeningClient.js';
import { HeldNotice } from './HeldNotice.js';
import { FlagReview } from './FlagReview.js';

/**
 * [SCREEN-REVIEW] The review that sits BESIDE the streaming Book Scan (Option C, owner ruling): a rep
 * sees value and the held count in the same moment, non-blocking. Account-wide (GET /notes/held) so a rep
 * who skipped review and returned tomorrow still finds their held messages — the case the control exists
 * for. It carries the FULL coverage line (the honest not-exhaustive warning, shown when a rep might think
 * they're finished) + the persistent held count, then a FlagReview per held note. Renders nothing when
 * nothing is held. On any restore it reloads and notifies the parent, so the scan can pull the new findings.
 */
export function HeldReview({ api, clientName, onChanged }: {
  api: ScreeningApi;
  clientName: (clientId: string) => string;
  onChanged?: () => void;
}): JSX.Element | null {
  const [held, setHeld] = useState<HeldNoteSummary[] | null>(null);
  const load = useCallback(async () => { setHeld(await api.held()); }, [api]);
  useEffect(() => { void load(); }, [load]);

  if (!held || held.length === 0) return null;
  const total = held.reduce((s, h) => s + h.held, 0);

  return (
    <section aria-label="Held for review" data-testid="held-review">
      <header className="tov-screenhead">
        <div className="tov-stamp">Before it's analysed</div>
        <h2>Messages held for your review</h2>
      </header>
      <HeldNotice variant="full" />
      <HeldNotice variant="indicator" held={total} />
      {held.map((h) => (
        <div key={h.noteId} style={{ marginTop: '1.25rem' }}>
          <div className="tov-stamp" data-testid={`held-client-${h.noteId}`}>{clientName(h.clientId)}</div>
          <FlagReview noteId={h.noteId} api={api} onRestored={() => { void load(); onChanged?.(); }} />
        </div>
      ))}
    </section>
  );
}
