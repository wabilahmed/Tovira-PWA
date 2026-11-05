/**
 * [P63-6 · owner] Admin → Funnel: where invited leads and public requests stop. One row per person who entered the
 * funnel (an invite email sent, or a request form submitted), with each step's date; the counts are counted from those
 * same rows, so they always match. Everything comes from our own records:
 *   invite sent (hot_leads.invite_sent_at), link opened (invite_opened_at, from P63), form submitted (the access
 *   request), approved (its review), password set (the set-password link used), first sign-in and first client (the
 *   admin's once-per-person event emails, P60, or the account's own first session / first note, whichever is earlier).
 * The owner's test leads and test requests are left out. Owner plane only; never a rep route.
 */
export type FunnelSourceKind = 'invite' | 'public' | 'admin';
export interface FunnelPerson {
  key: string;
  name: string | null;
  email: string | null;
  company: string | null;
  source: FunnelSourceKind;
  isTest: boolean;
  inviteSentAt: number | null;
  inviteOpenedAt: number | null;
  submittedAt: number | null;
  approvedAt: number | null;
  passwordSetAt: number | null;
  firstSignInAt: number | null;
  firstClientAt: number | null;
}
export interface FunnelSource { people(): Promise<FunnelPerson[]> }

export type FunnelPeriod = '7d' | '30d' | 'all';
export const FUNNEL_PERIODS: readonly FunnelPeriod[] = ['7d', '30d', 'all'];
const PERIOD_DAYS: Record<FunnelPeriod, number | null> = { '7d': 7, '30d': 30, all: null };

export interface FunnelCounts {
  invitesSent: number;
  linksOpened: number;
  formsSubmitted: { invite: number; public: number; total: number };
  approved: number;
  passwordSet: number;
  firstSignIn: number;
  firstClient: number;
}
export interface FunnelReport { period: FunnelPeriod; since: number | null; counts: FunnelCounts; rows: FunnelPerson[] }

/** When the person entered the funnel: the invite email, or (no invite) the form. */
export const enteredAt = (p: FunnelPerson): number | null => p.inviteSentAt ?? p.submittedAt ?? p.approvedAt;

export function funnelReport(people: FunnelPerson[], period: FunnelPeriod, now: number): FunnelReport {
  const days = PERIOD_DAYS[period];
  const since = days === null ? null : now - days * 86_400_000;
  const rows = people
    .filter((p) => !p.isTest)
    .filter((p) => { const e = enteredAt(p); return e !== null && (since === null || e >= since); })
    .sort((a, b) => (enteredAt(b) ?? 0) - (enteredAt(a) ?? 0));
  const n = (f: (p: FunnelPerson) => unknown): number => rows.filter((p) => f(p) != null).length;
  const invite = rows.filter((p) => p.source === 'invite' && p.submittedAt != null).length;
  const pub = rows.filter((p) => p.source === 'public' && p.submittedAt != null).length;
  return {
    period, since, rows,
    counts: {
      invitesSent: n((p) => p.inviteSentAt),
      linksOpened: n((p) => p.inviteOpenedAt),
      formsSubmitted: { invite, public: pub, total: invite + pub },
      approved: n((p) => p.approvedAt),
      passwordSet: n((p) => p.passwordSetAt),
      firstSignIn: n((p) => p.firstSignInAt),
      firstClient: n((p) => p.firstClientAt),
    },
  };
}
