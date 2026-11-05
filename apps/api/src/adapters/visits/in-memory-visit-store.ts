import type { DayRollup, PageView, VisitStore } from '../../services/visits/visits.js';
import { rollupOf } from '../../services/visits/visits.js';

/** [P63-7] Test/dev visit store, with the same day rules as the pg one. */
export class InMemoryVisitStore implements VisitStore {
  readonly salts = new Map<string, string>();
  readonly excluded = new Set<string>();
  readonly list: PageView[] = [];
  readonly days: DayRollup[] = [];
  async saltFor(day: string, fresh: () => string): Promise<string> {
    if (!this.salts.has(day)) this.salts.set(day, fresh());
    return this.salts.get(day)!;
  }
  async isExcluded(day: string, hash: string): Promise<boolean> { return this.excluded.has(`${day}|${hash}`); }
  async exclude(day: string, hash: string): Promise<void> {
    this.excluded.add(`${day}|${hash}`);
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i]!.day === day && this.list[i]!.visitorHash === hash) this.list.splice(i, 1);
  }
  async add(view: PageView): Promise<void> { this.list.push({ ...view }); }
  async rollupBefore(today: string): Promise<number> {
    const days = [...new Set(this.list.filter((v) => v.day < today && v.visitorHash).map((v) => v.day))];
    for (const d of days) {
      this.days.push(rollupOf(d, this.list.filter((v) => v.day === d)));
      for (const v of this.list) if (v.day === d) v.visitorHash = null;
    }
    for (const d of [...this.salts.keys()]) if (d < today) this.salts.delete(d);
    for (const k of [...this.excluded]) if (k.slice(0, 10) < today) this.excluded.delete(k);
    return days.length;
  }
  async views(sinceDay: string | null): Promise<PageView[]> { return this.list.filter((v) => sinceDay === null || v.day >= sinceDay).map((v) => ({ ...v })); }
  async rollups(sinceDay: string | null): Promise<DayRollup[]> { return this.days.filter((d) => sinceDay === null || d.day >= sinceDay).map((d) => ({ ...d })); }
}
