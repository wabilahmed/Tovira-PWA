import { useEffect, useState } from 'react';
import { MatchSuggestion } from './MatchSuggestion.js';
import type { MatchSuggestion as Match, ShareResult } from './inventoryClient.js';

/** The match methods this section needs (dependency-injected for tests). */
export interface BriefMatchApi {
  matches(clientId?: string): Promise<{ suggestions: Match[]; badge: number }>;
  shareFromSuggestion(matchId: string): Promise<ShareResult | null>;
  dismissMatch(matchId: string): Promise<boolean>;
}

/**
 * [INV-MATCH] The pre-meeting brief's inventory-suggestions section — the PRIMARY surface, read
 * minutes before the meeting (§11.4). Each suggestion shows the client's own quoted requirement +
 * date (via the shared chit) with Share and Dismiss inline. Renders nothing when there are none.
 */
export function BriefMatches({
  api,
  clientId,
  onOpenNote,
}: {
  api: BriefMatchApi;
  clientId: string;
  onOpenNote?: (noteId: string) => void;
}): JSX.Element | null {
  const [suggestions, setSuggestions] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);

  function reload(): void {
    void api.matches(clientId).then((r) => setSuggestions(r.suggestions));
  }
  useEffect(reload, [api, clientId]);

  async function act(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    await fn();
    setBusy(false);
    reload(); // a shared match dismisses and a dismissed one is gone — reload reflects both
  }

  if (suggestions.length === 0) return null;
  return (
    <div style={{ margin: '0.75rem 0' }} data-testid="brief-matches">
      <div className="tov-stamp">Suggested from your inventory</div>
      <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.35rem' }}>
        {suggestions.map((m) => (
          <MatchSuggestion
            key={m.matchId}
            match={m}
            busy={busy}
            onShare={(id) => void act(() => api.shareFromSuggestion(id))}
            onDismiss={(id) => void act(() => api.dismissMatch(id))}
            onOpenNote={onOpenNote}
          />
        ))}
      </div>
    </div>
  );
}
