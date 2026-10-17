import { describe, it, expect } from 'vitest';
import { planPromiseBackfill, type PromiseRow } from './backfill-promise-dates.js';

// A stub resolver standing in for resolveDueDate — "by Thursday" resolves, anything else does not.
const resolve = (raw: string): string | null => (raw === 'by Thursday' ? '2026-03-05' : null);

describe('[P18-4] planPromiseBackfill', () => {
  it('resolves a relative phrase against the promise anchor; leaves un-resolvable ones untouched', () => {
    const rows: PromiseRow[] = [
      { id: 'a', dueRaw: 'by Thursday', anchorDay: '2026-03-02' },
      { id: 'b', dueRaw: 'sometime soon', anchorDay: '2026-03-02' },
    ];
    const plan = planPromiseBackfill(rows, resolve);
    expect(plan.resolved).toEqual([{ id: 'a', dueRaw: 'by Thursday', anchorDay: '2026-03-02', dueDate: '2026-03-05' }]);
    expect(plan.unresolved).toEqual([{ id: 'b', dueRaw: 'sometime soon', anchorDay: '2026-03-02' }]);
  });

  // Product rule: a wrong fact is worse than a missing one — a null resolution is NEVER written.
  it('never writes a guess — a null resolution is reported as unresolved, never as a date', () => {
    const plan = planPromiseBackfill([{ id: 'c', dueRaw: 'next week', anchorDay: '2026-03-02' }], () => null);
    expect(plan.resolved).toHaveLength(0);
    expect(plan.unresolved).toHaveLength(1);
  });

  it('passes the per-promise anchor to the resolver (relative dates resolve against the message date)', () => {
    const seen: Array<{ raw: string; anchor: string }> = [];
    planPromiseBackfill([{ id: 'd', dueRaw: 'by Thursday', anchorDay: '2026-03-02' }], (raw, anchor) => {
      seen.push({ raw, anchor });
      return '2026-03-05';
    });
    expect(seen).toEqual([{ raw: 'by Thursday', anchor: '2026-03-02' }]);
  });
});
