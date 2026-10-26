import { describe, it, expect } from 'vitest';
import { buildCostReport, costReportCsv, MARGIN_CEILING_AED, type BuildInput } from './cost-report.js';
import { usdToAed, transcriptionCostUsd } from './ai-prices.js';

/**
 * [P44-2 · owner] The ops cost report: one row per user per period (billing period by default, calendar month as a
 * toggle). Cost = Claude + estimated voice (Groq, from recorded audio seconds); revenue = what Stripe says was paid
 * (subscription + top-ups); margin in AED and %. A user whose AI cost passes AED 67 (the margin ceiling) is flagged,
 * and so is anyone at or past their spending cap (billing-period view). A totals row per period group. No model calls.
 */
const U1 = 'u1', U2 = 'u2';
const OCT = Date.parse('2026-10-01T09:00:00Z');
const P_OCT = `p:${OCT}`;
const base = (o: Partial<BuildInput> = {}): BuildInput => ({
  view: 'period',
  claude: [], voice: [], revenue: [], legacy: [], capSpend: [], subscriptions: [],
  emails: new Map([[U1, 'layla@x.io'], [U2, 'omar@x.io']]),
  capFor: () => 45,
  voiceSince: Date.parse('2026-09-01T00:00:00Z'),
  ...o,
});
const fils = (aed: number) => Math.round(aed * 100);

describe('[P44-2] margin maths', () => {
  it('cost = Claude + voice; margin = revenue − cost; % of revenue', () => {
    const voiceAed = usdToAed(transcriptionCostUsd('whisper-large-v3', 600)); // 10 minutes
    const r = buildCostReport(base({
      claude: [{ userId: U1, key: P_OCT, spendClass: 'extraction', aed: 20, calls: 40 }, { userId: U1, key: P_OCT, spendClass: 'recall', aed: 5, calls: 10 }],
      voice: [{ userId: U1, key: P_OCT, model: 'whisper-large-v3', audioSeconds: 600, estimated: false }],
      revenue: [{ userId: U1, key: P_OCT, kind: 'subscription', fils: fils(299) }, { userId: U1, key: P_OCT, kind: 'topup', fils: fils(49) }],
      subscriptions: [{ userId: U1, status: 'active', periodStart: OCT, periodEnd: OCT + 31 * 86_400_000 }],
    }));
    const row = r.rows[0]!;
    expect(row).toMatchObject({ email: 'layla@x.io', plan: 'Monthly', claudeAed: 25, calls: 50, byClass: { extraction: 20, recall: 5 }, revenueAed: 348 });
    expect(row.voiceAed).toBeCloseTo(voiceAed, 10);
    expect(row.totalCostAed).toBeCloseTo(25 + voiceAed, 10);
    expect(row.marginAed).toBeCloseTo(348 - 25 - voiceAed, 10);
    expect(row.marginPct).toBeCloseTo(((348 - 25 - voiceAed) / 348) * 100, 10);
  });

  it('a transcription under 10 seconds is billed at Groq\'s 10-second minimum', () => {
    const r = buildCostReport(base({ voice: [{ userId: U1, key: P_OCT, model: 'whisper-large-v3', audioSeconds: 3, estimated: false }] }));
    expect(r.rows[0]!.voiceAed).toBeCloseTo(usdToAed(transcriptionCostUsd('whisper-large-v3', 10)), 12);
  });

  it('no revenue (a trial): margin is minus the cost and the % is empty, never a division by zero', () => {
    const r = buildCostReport(base({ claude: [{ userId: U1, key: `t:${OCT}`, spendClass: 'extraction', aed: 12, calls: 3 }], subscriptions: [{ userId: U1, status: 'trialing', periodStart: null, periodEnd: null }] }));
    expect(r.rows[0]).toMatchObject({ plan: 'Trial', revenueAed: 0, marginAed: -12, marginPct: null });
  });

  it('a totals row per period group: cost, revenue and margin across users', () => {
    const r = buildCostReport(base({
      claude: [{ userId: U1, key: P_OCT, spendClass: 'extraction', aed: 30, calls: 1 }, { userId: U2, key: `p:${OCT + 5 * 86_400_000}`, spendClass: 'extraction', aed: 10, calls: 1 }],
      revenue: [{ userId: U1, key: P_OCT, kind: 'subscription', fils: fils(299) }, { userId: U2, key: `p:${OCT + 5 * 86_400_000}`, kind: 'subscription', fils: fils(299) }],
      voiceSince: null,
    }));
    expect(r.totals).toEqual([{ group: '2026-10', label: 'Periods starting Oct 2026', costAed: 40, revenueAed: 598, marginAed: 558, marginPct: (558 / 598) * 100 }]);
  });
});

describe('[P44-2] the AED 67 margin ceiling and the spending cap', () => {
  it(`flags AI cost above AED ${MARGIN_CEILING_AED}; exactly ${MARGIN_CEILING_AED} is not past it`, () => {
    const r = buildCostReport(base({ claude: [{ userId: U1, key: P_OCT, spendClass: 'extraction', aed: 67, calls: 1 }, { userId: U2, key: P_OCT, spendClass: 'extraction', aed: 67.01, calls: 1 }] }));
    const by = Object.fromEntries(r.rows.map((x) => [x.email, x.overCeiling]));
    expect(by).toEqual({ 'layla@x.io': false, 'omar@x.io': true });
  });

  it('voice counts towards the ceiling (AI cost = Claude + voice)', () => {
    const r = buildCostReport(base({ claude: [{ userId: U1, key: P_OCT, spendClass: 'extraction', aed: 66.99, calls: 1 }], voice: [{ userId: U1, key: P_OCT, model: 'whisper-large-v3', audioSeconds: 3600, estimated: false }] }));
    expect(r.rows[0]!.overCeiling).toBe(true);
  });

  it('flags at or past the cap the app enforces for that period (spend as the cap counts it)', () => {
    const capFor = (_u: string, k: string) => (k.startsWith('t:') ? 15 : 45);
    const r = buildCostReport(base({
      capFor,
      claude: [{ userId: U1, key: P_OCT, spendClass: 'extraction', aed: 45, calls: 1 }, { userId: U2, key: `t:${OCT}`, spendClass: 'extraction', aed: 10, calls: 1 }],
      capSpend: [{ userId: U1, periodKey: P_OCT, aed: 45 }, { userId: U2, periodKey: `t:${OCT}`, aed: 10 }],
    }));
    const by = Object.fromEntries(r.rows.map((x) => [x.email, x.cap]));
    expect(by['layla@x.io']).toEqual({ capAed: 45, spentAed: 45, reached: true });
    expect(by['omar@x.io']).toEqual({ capAed: 15, spentAed: 10, reached: false });
  });
});

describe('[P44-2] billing period (default) vs calendar month', () => {
  it('the same data groups by the rep\'s billing period, or by calendar month', () => {
    const period = buildCostReport(base({ claude: [{ userId: U1, key: P_OCT, spendClass: 'extraction', aed: 5, calls: 1 }] }));
    expect(period.rows.map((x) => [x.key, x.periodLabel])).toEqual([[P_OCT, 'from 1 Oct 2026']]);
    const month = buildCostReport(base({ view: 'month', claude: [{ userId: U1, key: '2026-10', spendClass: 'extraction', aed: 5, calls: 1 }] }));
    expect(month.rows.map((x) => [x.key, x.periodLabel])).toEqual([['2026-10', 'Oct 2026']]);
    expect(month.totals.map((t) => t.label)).toEqual(['Oct 2026']);
  });

  it('NEGATIVE: the cap flag is only shown in the billing-period view (the cap is per billing period)', () => {
    const month = buildCostReport(base({ view: 'month', claude: [{ userId: U1, key: '2026-10', spendClass: 'extraction', aed: 50, calls: 1 }], capSpend: [{ userId: U1, periodKey: P_OCT, aed: 50 }] }));
    expect(month.rows[0]!.cap).toBeNull();
    expect(month.rows[0]!.overCeiling).toBe(false); // 50 < 67
  });

  it('an invoice recorded before revenue events: its month, or the rep\'s period starting at or before it', () => {
    const legacy = [{ userId: U1, issuedAt: OCT + 60_000, fils: fils(299) }];
    const claude = [{ userId: U1, key: P_OCT, spendClass: 'extraction', aed: 5, calls: 1 }];
    expect(buildCostReport(base({ legacy, claude })).rows[0]).toMatchObject({ key: P_OCT, revenueAed: 299 });
    expect(buildCostReport(base({ view: 'month', legacy, claude: [] })).rows[0]).toMatchObject({ key: '2026-10', revenueAed: 299 });
    expect(buildCostReport(base({ legacy: [{ userId: U2, issuedAt: OCT, fils: fils(299) }] })).rows[0]).toMatchObject({ key: 'unattributed', revenueAed: 299 });
  });

  it('NEGATIVE: voice is "not recorded" (null) for a period with no voice rows that began before recording started', () => {
    const r = buildCostReport(base({ voiceSince: OCT + 10 * 86_400_000, claude: [{ userId: U1, key: P_OCT, spendClass: 'extraction', aed: 5, calls: 1 }] }));
    expect(r.rows[0]!.voiceAed).toBeNull();
    expect(r.rows[0]!.totalCostAed).toBe(5);
    const after = buildCostReport(base({ voiceSince: OCT - 86_400_000, claude: [{ userId: U1, key: P_OCT, spendClass: 'extraction', aed: 5, calls: 1 }] }));
    expect(after.rows[0]!.voiceAed).toBe(0);
  });
});

describe('[P44-2] CSV', () => {
  it('one line per row plus the totals, with a header; text is quoted', () => {
    const r = buildCostReport(base({ claude: [{ userId: U1, key: P_OCT, spendClass: 'extraction', aed: 70, calls: 2 }], revenue: [{ userId: U1, key: P_OCT, kind: 'subscription', fils: fils(299) }] }));
    const lines = costReportCsv(r).trim().split('\n');
    expect(lines[0]).toBe('period,email,plan,claude_aed,voice_aed,voice_seconds,total_cost_aed,calls,by_type,revenue_aed,margin_aed,margin_pct,over_67,cap_aed,at_cap');
    expect(lines[1]).toBe('"from 1 Oct 2026","layla@x.io","—",70.00,0.00,0,70.00,2,"extraction:70.00",299.00,229.00,76.6,yes,45,yes');
    expect(lines[2]).toBe('"TOTAL Periods starting Oct 2026","","",,,,70.00,,"",299.00,229.00,76.6,,,');
  });
});
