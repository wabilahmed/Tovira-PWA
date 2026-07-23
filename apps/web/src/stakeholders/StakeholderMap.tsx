import { useEffect, useState } from 'react';
import type { Stakeholder } from '../clients/clientsClient.js';

export interface StakeholderApi {
  getStakeholders(clientId: string): Promise<Stakeholder[]>;
}

const GROUPS: Array<{ role: string; label: string }> = [
  { role: 'decision_maker', label: 'Decision makers' },
  { role: 'influencer', label: 'Influencers' },
  { role: 'blocker', label: 'Blockers' },
  { role: 'unknown', label: 'Others' },
];

/** Who's who in the deal (P4-2): people grouped by their decision role. */
export function StakeholderMap({ clientId, api }: { clientId: string; api: StakeholderApi }): JSX.Element {
  const [people, setPeople] = useState<Stakeholder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void api.getStakeholders(clientId).then((p) => {
      if (!live) return;
      setPeople(p);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [api, clientId]);

  if (loading) return <p>Loading stakeholders…</p>;
  if (people.length === 0) return <p style={{ color: '#666' }}>No stakeholders captured yet.</p>;

  return (
    <section aria-label="Stakeholders">
      {GROUPS.map((g) => {
        const inGroup = people.filter((p) => (p.decision_role || 'unknown') === g.role);
        if (inGroup.length === 0) return null;
        return (
          <div key={g.role} data-testid={`group-${g.role}`}>
            <strong>{g.label}</strong>
            <ul>
              {inGroup.map((p, i) => (
                <li key={i}>
                  {p.name ?? 'Unknown'}
                  {p.role ? `, ${p.role}` : ''}
                  {p.reports_to ? <small style={{ color: '#888' }}> · reports to {p.reports_to}</small> : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
