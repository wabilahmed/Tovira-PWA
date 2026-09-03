import { useEffect, useState } from 'react';
import type { SharedWithClient } from './inventoryClient.js';

export interface ClientInventoryApi {
  sharesForClient(clientId: string): Promise<SharedWithClient[]>;
}

const OUTCOME_LABEL: Record<SharedWithClient['outcome'], string> = {
  pending: 'AWAITING',
  bought: 'BOUGHT',
  declined: 'DECLINED',
  no_response: 'NO REPLY',
};

/** Client-detail section: what has been shared with this client. Renders nothing when empty
 *  (an absent section beats an empty one), so it never clutters a client with no shares. */
export function ClientInventory({ api, clientId }: { api: ClientInventoryApi; clientId: string }): JSX.Element | null {
  const [shares, setShares] = useState<SharedWithClient[]>([]);
  useEffect(() => { let live = true; void api.sharesForClient(clientId).then((s) => { if (live) setShares(s); }); return () => { live = false; }; }, [api, clientId]);

  if (shares.length === 0) return null;
  return (
    <section className="tov-client-inv" aria-label="Inventory shared with this client">
      <div className="tov-stamp">Inventory shared</div>
      <ul className="tov-list-plain">
        {shares.map((s) => (
          <li key={s.id} className="tov-inv-shared">
            <span className="tov-inv-shared__title">{s.itemTitle}</span>
            <span className="tov-stamp">{OUTCOME_LABEL[s.outcome]}</span>
            <span className="tov-mono tov-inv-shared__date">{new Date(s.sharedAt).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
