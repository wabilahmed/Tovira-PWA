/**
 * Volume gate for the hero features (P4b-4). Patterns on thin data are noise —
 * and a confident-but-wrong pattern is worse than a missed fact — so pattern
 * intelligence + deal-risk radar stay LOCKED until the rep's book passes a
 * threshold. Enforced server-side; the client can't flip it. The exact numbers
 * are an open question to tune on beta data (config, not a locked decision).
 */
export interface VolumeCounts {
  clients: number;
  notes: number;
}

export interface VolumeGateConfig {
  minClients: number;
  minNotes: number;
}

export interface GateState {
  unlocked: boolean;
  counts: VolumeCounts;
  needed: { clients: number; notes: number };
  message: string;
}

export function evaluateGate(counts: VolumeCounts, config: VolumeGateConfig): GateState {
  const neededClients = Math.max(0, config.minClients - counts.clients);
  const neededNotes = Math.max(0, config.minNotes - counts.notes);
  const unlocked = neededClients === 0 && neededNotes === 0;
  const message = unlocked
    ? 'Pattern insights are active.'
    : `Keep feeding Tovira: ${neededClients} more client${neededClients === 1 ? '' : 's'} and ` +
      `${neededNotes} more note${neededNotes === 1 ? '' : 's'} unlock cross-client pattern insights.`;
  return { unlocked, counts, needed: { clients: neededClients, notes: neededNotes }, message };
}
