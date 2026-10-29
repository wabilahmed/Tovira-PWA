import type { HotLead, HotLeadsStore, LeadStatus } from '../ports/hot-leads.js';
import { LEAD_STATUSES } from '../ports/hot-leads.js';
import type { LeadInviteService, InviteRefusal } from '../services/leads/lead-invite-service.js';
import { BadJsonError, readJsonBody, sendJson } from './helpers.js';
import type { AdminDataRoute } from './admin-routes.js';

/**
 * [P45-3 · owner] Hot leads in the admin console (admin session only; leads are never on a rep route).
 *  GET   /admin/leads?status=&country=[&format=csv]   newest first, the New count, Explee's banner/last run
 *  PATCH /admin/leads/:id { status?, notes? }          audited
 *  [P58 · owner] "Invite to beta" (a pending request with blank answers) is replaced by the invite email:
 *  POST  /admin/leads/:id/invite-email/preview { personalLine }   what would be sent; nothing is sent or recorded
 *  POST  /admin/leads/:id/invite-email { personalLine, resend? }  send once; Resend after 3 days, once; audited
 *  POST  /admin/leads/test { name, email, companyName?, jobTitle? }  the owner's test lead (never counted/exported)
 */
const REFUSAL_STATUS: Record<InviteRefusal['code'], number> = { erased: 409, missing: 400, not_interested: 409, has_account: 409, requested: 409, on_access_tab: 409, already_sent: 409, too_soon: 409, already_resent: 409, not_sent: 409, send_failed: 502 };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const q = (s: string | null | undefined): string => `"${(s ?? '').replace(/"/g, '""')}"`;
function leadsCsv(leads: HotLead[]): string {
  const head = 'became_hot_at,status,name,email,job_title,company_name,company_domain,country,phone,linkedin_url,campaign,why_hot,notes';
  const rows = leads.map((l) => [l.becameHotAt ? new Date(l.becameHotAt).toISOString() : '', l.status, q(l.name), q(l.email), q(l.jobTitle), q(l.companyName), q(l.companyDomain), q(l.country), q(l.phone), q(l.linkedinUrl), q(l.campaignName), q(l.whyHot), q(l.notes)].join(','));
  return `${[head, ...rows].join('\n')}\n`;
}

export function adminLeadsRoute(deps: { store: HotLeadsStore; invites?: LeadInviteService; now?: () => number }): AdminDataRoute {
  const now = deps.now ?? (() => Date.now());
  return async (req, res, url, ctx) => {
    if (!url.pathname.startsWith('/admin/leads')) return false;
    const method = req.method ?? 'GET';
    if (method === 'GET' && url.pathname === '/admin/leads') {
      const status = url.searchParams.get('status') ?? undefined;
      if (status && !LEAD_STATUSES.includes(status as LeadStatus)) { sendJson(res, 400, { error: 'validation', message: 'Unknown status.' }); return true; }
      const country = url.searchParams.get('country')?.trim().toUpperCase() || undefined;
      const leads = await deps.store.list({ status: status as LeadStatus | undefined, country });
      if (url.searchParams.get('format') === 'csv') {
        const real = leads.filter((l) => !l.isTest); // [P58] a test lead is never exported
        await ctx.audit('leads.csv_export', null, { status: status ?? null, country: country ?? null, rows: real.length });
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="tovira-hot-leads-${new Date(now()).toISOString().slice(0, 10)}.csv"`, 'cache-control': 'no-store' });
        res.end(leadsCsv(real));
        return true;
      }
      const all = status || country ? await deps.store.list({}) : leads;
      sendJson(res, 200, {
        leads,
        newCount: all.filter((l) => l.status === 'new' && !l.isTest).length, // [P58] a test lead never counts
        countries: [...new Set(all.map((l) => l.country).filter((c): c is string => !!c))].sort(),
        sync: await deps.store.getState(),
      });
      return true;
    }
    // [P58-4] the owner's test lead, to try the invite email on himself
    if (method === 'POST' && url.pathname === '/admin/leads/test') {
      let body: { name?: unknown; email?: unknown; companyName?: unknown; jobTitle?: unknown };
      try { body = (await readJsonBody(req)) as typeof body; } catch (e) { if (e instanceof BadJsonError) { sendJson(res, 400, { error: 'bad_request' }); return true; } throw e; }
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!name || !EMAIL_RE.test(email)) { sendJson(res, 400, { error: 'validation', message: 'A test lead needs a name and a valid email.' }); return true; }
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);
      const lead = await deps.store.createTestLead({ name: name.slice(0, 200), email, companyName: str(body.companyName), jobTitle: str(body.jobTitle) }, now());
      await ctx.audit('lead.test_created', email, { leadId: lead.id });
      sendJson(res, 201, { lead });
      return true;
    }
    const m = /^\/admin\/leads\/([^/]+)(\/invite-email(?:\/preview)?)?$/.exec(url.pathname);
    if (!m) return false;
    const id = decodeURIComponent(m[1]!);
    const lead = await deps.store.get(id);
    if (!lead) { sendJson(res, 404, { error: 'not_found' }); return true; }

    if (method === 'PATCH' && !m[2]) {
      let body: { status?: unknown; notes?: unknown };
      try { body = (await readJsonBody(req)) as typeof body; } catch (e) { if (e instanceof BadJsonError) { sendJson(res, 400, { error: 'bad_request' }); return true; } throw e; }
      const patch: { status?: LeadStatus; notes?: string | null } = {};
      if (body.status !== undefined) {
        if (!LEAD_STATUSES.includes(body.status as LeadStatus)) { sendJson(res, 400, { error: 'validation', message: 'Unknown status.' }); return true; }
        patch.status = body.status as LeadStatus;
      }
      if (body.notes !== undefined) {
        if (body.notes !== null && typeof body.notes !== 'string') { sendJson(res, 400, { error: 'validation', message: 'Notes must be text.' }); return true; }
        patch.notes = typeof body.notes === 'string' ? body.notes.slice(0, 5000) : null;
      }
      const updated = await deps.store.update(id, patch, now());
      if (patch.status && patch.status !== lead.status) await ctx.audit('lead.status', lead.email ?? `lead ${id}`, { from: lead.status, to: patch.status });
      if (patch.notes !== undefined && patch.notes !== lead.notes) await ctx.audit('lead.notes', lead.email ?? `lead ${id}`, null);
      sendJson(res, 200, { lead: updated });
      return true;
    }

    // [P58-4] the invite email: a preview (nothing sent), then Send (once) or Resend (after 3 days, once)
    if (method === 'POST' && m[2] && deps.invites) {
      let body: { personalLine?: unknown; resend?: unknown };
      try { body = (await readJsonBody(req)) as typeof body; } catch (e) { if (e instanceof BadJsonError) { sendJson(res, 400, { error: 'bad_request' }); return true; } throw e; }
      const personalLine = typeof body.personalLine === 'string' ? body.personalLine.slice(0, 500) : null;
      if (m[2] === '/invite-email/preview') {
        const refusal = await deps.invites.refusal(lead);
        sendJson(res, 200, { ...deps.invites.preview(lead, personalLine), refusal });
        return true;
      }
      const resend = body.resend === true;
      const r = await deps.invites.send(lead, personalLine, resend);
      if (!r.ok) { sendJson(res, REFUSAL_STATUS[r.refusal.code], { error: r.refusal.code, message: r.refusal.message }); return true; }
      await ctx.audit(resend ? 'lead.invite_email_resend' : 'lead.invite_email', lead.email, { leadId: id, expiresAt: new Date(r.lead.inviteExpiresAt!).toISOString(), personalLine: personalLine?.trim() || null, test: r.lead.isTest === true });
      sendJson(res, 200, { lead: r.lead });
      return true;
    }
    return false;
  };
}
