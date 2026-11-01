import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runFunnelDiagnose, resendDelivery, parseFunnelArgs } from './funnel-diagnose.js';

// [P63-1 · owner] Report only: where invited leads and public requests stop. Read-only by construction; emails hidden.
const NOW = Date.parse('2026-11-01T09:00:00Z');
function fakeDb(rows: { leads?: Array<Record<string, unknown>>; totals?: Array<Record<string, unknown>>; requests?: Array<Record<string, unknown>> }) {
  const seen: string[] = [];
  return { seen, query: async (sql: string) => {
    seen.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
    if (/^\s*SELECT a\.id/.test(sql)) return { rows: rows.requests ?? [] };
    if (/GROUP BY status/.test(sql)) return { rows: rows.totals ?? [] };
    if (/^\s*SELECT h\.id/.test(sql)) return { rows: rows.leads ?? [] };
    return { rows: [] };
  } };
}

describe('[P63-1] funnel-diagnose', () => {
  it('one line per invited lead with each step, emails hidden; "link opened" is said to be not recorded', async () => {
    const out = await runFunnelDiagnose(fakeDb({ leads: [{ email: 'sara@emaar.example', is_test: false, lead_status: 'invited', invite_sent_at: new Date('2026-10-28T10:00:00Z'), invite_resent_at: null, requested_at: null, request_status: null, reviewed_at: null, password_set_at: null, first_session_at: null, first_note_at: null }], totals: [{ status: 'invited', n: 1 }, { status: 'new', n: 40 }] }), NOW);
    expect(out.join('\n')).toContain('sar…@emaar.example  lead invited  invite sent 2026-10-28 10:00  link opened: not recorded  form -');
    expect(out.join('\n')).not.toContain('sara@emaar.example');
    expect(out.join('\n')).toContain('hot leads by status (all time, tests excluded): invited 1, new 40');
  });
  it('requests: public vs invite, pending waiting for the admin, and an approved person whose set-password link expired unused', async () => {
    const out = (await runFunnelDiagnose(fakeDb({ requests: [
      { work_email: 'dana@brokerage.example', source: 'form', status: 'pending', created_at: new Date('2026-10-25T08:00:00Z'), from_invite_email: false, link_expires_at: null, link_used: null },
      { work_email: 'omar@aldar.example', source: 'form', status: 'invited', created_at: new Date('2026-10-20T08:00:00Z'), from_invite_email: true, link_expires_at: new Date('2026-10-27T08:00:00Z'), link_used: false },
    ] }), NOW)).join('\n');
    expect(out).toContain('requests: 2 (public form 1, from an invite email 1, made from a lead by the admin 0)');
    expect(out).toContain('pending (waiting for you): 1; approved, link not used yet: 1; activated: 0; rejected: 0');
    expect(out).toContain('pending since 2026-10-25 08:00: dan…@brokerage.example (form)');
    expect(out).toContain('approved but the set-password link EXPIRED unused (2026-10-27 08:00): oma…@aldar.example');
    expect(out).toContain('failed submissions (4xx/5xx): not recorded');
  });
  it('NEGATIVE: read-only: one READ ONLY transaction, rolled back; --apply and any argument refused', async () => {
    const db = fakeDb({});
    await runFunnelDiagnose(db, NOW);
    expect(db.seen[0]).toBe('BEGIN TRANSACTION READ');
    expect(db.seen.at(-1)).toBe('ROLLBACK');
    expect(() => parseFunnelArgs(['--apply'])).toThrow(/read-only/);
  });
  it('Resend: delivered / bounced / marked spam in the window; an opened email counts only as delivered (opens never reported)', async () => {
    const data = [
      { created_at: '2026-10-30T09:00:00Z', last_event: 'delivered' }, { created_at: '2026-10-30T09:00:00Z', last_event: 'opened' },
      { created_at: '2026-10-29T09:00:00Z', last_event: 'bounced' }, { created_at: '2026-10-29T09:00:00Z', last_event: 'complained' },
      { created_at: '2026-10-29T09:00:00Z', last_event: 'delivery_delayed' }, { created_at: '2026-09-01T09:00:00Z', last_event: 'bounced' },
    ];
    const f = async () => ({ ok: true, status: 200, json: async () => ({ data }) });
    expect(await resendDelivery(f, 'k', NOW - 14 * 86_400_000)).toEqual({ delivered: 2, bounced: 1, complained: 1, other: 1, checked: 5, note: null });
    expect((await resendDelivery(f, undefined, 0)).note).toMatch(/not set/);
    expect((await resendDelivery(async () => ({ ok: false, status: 401, json: async () => ({}) }), 'k', 0)).note).toMatch(/401/);
  });
  it('the ops runner knows it and treats it as read-only', () => {
    const sh = readFileSync(new URL('../../../../scripts/ops/run-backfill.sh', import.meta.url), 'utf8');
    expect(sh).toMatch(/funnel-diagnose\) SCRIPT_IN_IMAGE="apps\/api\/src\/scripts\/funnel-diagnose\.ts"/);
    expect(sh).toMatch(/\[ "\$SCRIPT_NAME" = "funnel-diagnose" \]/);
  });
});
