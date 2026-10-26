import type { HotLead, HotLeadsStore, LeadStatus } from '../ports/hot-leads.js';
import { LEAD_STATUSES } from '../ports/hot-leads.js';
import type { AccessRequestRepository } from '../ports/access-request-repository.js';
import { BadJsonError, readJsonBody, sendJson } from './helpers.js';
import type { AdminDataRoute } from './admin-routes.js';

/**
 * [P45-3 · owner] Hot leads in the admin console (admin session only; leads are never on a rep route).
 *  GET   /admin/leads?status=&country=[&format=csv]   newest first, the New count, Explee's banner/last run
 *  PATCH /admin/leads/:id { status?, notes? }          audited
 *  POST  /admin/leads/:id/invite                       a PENDING access request from the lead (source 'hot_lead'),
 *                                                      the lead → Invited. Nothing is sent until it is approved.
 */
const q = (s: string | null | undefined): string => `"${(s ?? '').replace(/"/g, '""')}"`;
function leadsCsv(leads: HotLead[]): string {
  const head = 'became_hot_at,status,name,email,job_title,company_name,company_domain,country,phone,linkedin_url,campaign,why_hot,notes';
  const rows = leads.map((l) => [l.becameHotAt ? new Date(l.becameHotAt).toISOString() : '', l.status, q(l.name), q(l.email), q(l.jobTitle), q(l.companyName), q(l.companyDomain), q(l.country), q(l.phone), q(l.linkedinUrl), q(l.campaignName), q(l.whyHot), q(l.notes)].join(','));
  return `${[head, ...rows].join('\n')}\n`;
}

export function adminLeadsRoute(deps: { store: HotLeadsStore; accessRequests: Pick<AccessRequestRepository, 'create'>; now?: () => number }): AdminDataRoute {
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
        await ctx.audit('leads.csv_export', null, { status: status ?? null, country: country ?? null, rows: leads.length });
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="tovira-hot-leads-${new Date(now()).toISOString().slice(0, 10)}.csv"`, 'cache-control': 'no-store' });
        res.end(leadsCsv(leads));
        return true;
      }
      const all = status || country ? await deps.store.list({}) : leads;
      sendJson(res, 200, {
        leads,
        newCount: all.filter((l) => l.status === 'new').length,
        countries: [...new Set(all.map((l) => l.country).filter((c): c is string => !!c))].sort(),
        sync: await deps.store.getState(),
      });
      return true;
    }
    const m = /^\/admin\/leads\/([^/]+)(\/invite)?$/.exec(url.pathname);
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

    if (method === 'POST' && m[2] === '/invite') {
      if (lead.accessRequestId) { sendJson(res, 409, { error: 'already_invited', message: 'This lead already has an access request.' }); return true; }
      if (!lead.email || !lead.name) { sendJson(res, 400, { error: 'validation', message: 'This lead has no name or email to invite.' }); return true; }
      const request = await deps.accessRequests.create({
        source: 'hot_lead',
        fullName: lead.name, workEmail: lead.email.trim().toLowerCase(), phone: lead.phone ?? null,
        companyName: lead.companyName ?? '', roleTitle: lead.jobTitle ?? '',
        // the lead never answered the form: these stay empty, and Industry is left for the admin to set
        ownership: null, tradeLicenceNumber: null, conversationOwnership: null, conversationOwnershipOther: null, expectedVolume: null,
        confirmationAcceptedAt: null, confirmationTextVersion: null, sourceIp: null, userAgent: null, referralCode: null, industry: null, industryOther: null,
      });
      const updated = await deps.store.update(id, { status: 'invited', accessRequestId: request.id }, now());
      await ctx.audit('lead.invite_to_beta', lead.email, { leadId: id, requestId: request.id });
      sendJson(res, 200, { lead: updated, request });
      return true;
    }
    return false;
  };
}
