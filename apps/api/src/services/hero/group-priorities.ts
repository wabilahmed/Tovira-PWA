import type { TodayAction, Pattern, RiskItem, PriorityReason } from './hero-service.js';

/**
 * [NOTIF-REWORK Task 5] Group the daily priorities by WHY something needs attention, so the surface
 * reads as analysis ("3 clients cooling", "2 promises past due", "1 inventory match") rather than a
 * flat ranked list. Mobile-first: each group is a titled, counted section the PWA renders as a card.
 *
 * Pure and cheap — it groups the ALREADY-COMPUTED actions/patterns/risks (the route passes the
 * precomputed cache + the volume-gated patterns/risk), so it triggers no new computation.
 *
 * Rules: a group with zero items is ABSENT (never rendered as "0"). Volume-gated findings (patterns,
 * deal-risk) are gated UPSTREAM — hero.patterns()/risk() return [] below their sample threshold — so
 * a thin-sample finding simply arrives as an empty list here and its group is omitted.
 */

export interface PriorityGroup {
  reason: PriorityReason | 'patterns' | 'risk';
  title: string; // human, count-led: "2 promises past due"
  count: number;
  actions?: TodayAction[]; // action-derived groups
  patterns?: Pattern[]; // the volume-gated patterns group
  risks?: RiskItem[]; // the volume-gated deal-risk group
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

// Render order: the most time-bound / highest-leverage reasons first.
const ACTION_GROUPS: Array<{ reason: PriorityReason; title: (n: number) => string }> = [
  { reason: 'promise_overdue', title: (n) => `${plural(n, 'promise', 'promises')} past due` },
  { reason: 'promise_due', title: (n) => `${plural(n, 'promise', 'promises')} due soon` },
  { reason: 'meeting', title: (n) => `${plural(n, 'meeting', 'meetings')} coming up` },
  { reason: 'cooling', title: (n) => `${plural(n, 'client', 'clients')} cooling` },
  { reason: 'match', title: (n) => `${plural(n, 'inventory match', 'inventory matches')} to review` },
];

export function groupPriorities(actions: TodayAction[], patterns: Pattern[], risks: RiskItem[]): PriorityGroup[] {
  const groups: PriorityGroup[] = [];

  for (const { reason, title } of ACTION_GROUPS) {
    const items = actions.filter((a) => a.reason === reason);
    if (items.length === 0) continue; // an empty group is ABSENT, not "0"
    groups.push({ reason, title: title(items.length), count: items.length, actions: items });
  }

  // Volume-gated groups: present only when the gate upstream let items through.
  if (patterns.length > 0) {
    groups.push({ reason: 'patterns', title: `${plural(patterns.length, 'pattern', 'patterns')} across your book`, count: patterns.length, patterns });
  }
  if (risks.length > 0) {
    groups.push({ reason: 'risk', title: `${plural(risks.length, 'deal', 'deals')} at risk`, count: risks.length, risks });
  }

  return groups;
}
