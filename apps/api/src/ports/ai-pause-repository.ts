/**
 * [USAGE-ALLOWANCE · D14] The runtime kill-switch flag — a single platform-global row. Read by the gate
 * (through a <=30s cache) and written by the token-gated /ops/ai-pause route. Not tenant-scoped.
 */
export interface AiPauseRepository {
  getPaused(): Promise<boolean>;
  setPaused(paused: boolean): Promise<void>;
}
