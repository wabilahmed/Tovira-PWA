import { describe, it, expect } from 'vitest';
import { InMemoryOpsAlertRepository } from './in-memory-ops-alert-repository.js';

describe('[SPEND-CAP] OpsAlertRepository — idempotent per (kind, dedupeKey)', () => {
  it('creates once, then no-ops on the same dedupe key (one alert per rep per period)', async () => {
    const repo = new InMemoryOpsAlertRepository();
    const alert = { kind: 'spend_warn', userId: 'rep-A', dedupeKey: 'spendcap80:rep-A:p:2026-09', detail: { spentAed: 37 } };
    expect(await repo.createIfAbsent(alert)).toBe(true);
    expect(await repo.createIfAbsent(alert)).toBe(false);
    expect(await repo.createIfAbsent({ ...alert, detail: { spentAed: 44 } })).toBe(false);
    expect(await repo.listRecent(10)).toHaveLength(1);
  });

  it('a new period is a new alert', async () => {
    const repo = new InMemoryOpsAlertRepository();
    await repo.createIfAbsent({ kind: 'spend_warn', userId: 'rep-A', dedupeKey: 'spendcap80:rep-A:p:2026-09', detail: {} });
    expect(await repo.createIfAbsent({ kind: 'spend_warn', userId: 'rep-A', dedupeKey: 'spendcap80:rep-A:p:2026-10', detail: {} })).toBe(true);
    expect(await repo.listRecent(10)).toHaveLength(2);
  });
});
