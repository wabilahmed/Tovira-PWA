import { useEffect, useState } from 'react';
import { MatchSuggestion } from './MatchSuggestion.js';
import type { MatchSuggestion as Match, ShareResult } from './inventoryClient.js';

export interface ItemMatchApi {
  itemMatches(itemId: string): Promise<Match[]>;
  shareFromSuggestion(matchId: string): Promise<ShareResult | null>;
  dismissMatch(matchId: string): Promise<boolean>;
}

/**
 * [INV-MATCH] The reverse direction, on an inventory item: the clients who already asked for
 * something like this. Same chit the brief sets — but it names the CLIENT (the item is known here),
 * with the client's own quoted requirement as the receipt. Share offers this item to that client;
 * dismiss removes the one match row from every surface. Renders nothing when there are none.
 */
export function ItemMatches({
  api,
  itemId,
  clientName,
}: {
  api: ItemMatchApi;
  itemId: string;
  clientName: (clientId: string) => string;
}): JSX.Element | null {
  const [suggestions, setSuggestions] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);

  function reload(): void {
    void api.itemMatches(itemId).then(setSuggestions);
  }
  useEffect(reload, [api, itemId]);

  async function act(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    await fn();
    setBusy(false);
    reload();
  }

  if (suggestions.length === 0) return null;
  return (
    <div style={{ marginTop: '0.6rem' }} data-testid="item-matches">
      <div className="tov-stamp">
        {suggestions.length} client{suggestions.length === 1 ? '' : 's'} asked for something like this
      </div>
      <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.35rem' }}>
        {suggestions.map((m) => (
          <MatchSuggestion
            key={m.matchId}
            match={m}
            heading={clientName(m.clientId)}
            busy={busy}
            onShare={(id) => void act(() => api.shareFromSuggestion(id))}
            onDismiss={(id) => void act(() => api.dismissMatch(id))}
          />
        ))}
      </div>
    </div>
  );
}
