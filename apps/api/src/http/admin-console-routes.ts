import type { AccessApprovalService } from '../services/access/access-approval-service.js';
import { AccessRequestNotFoundError } from '../services/access/access-approval-service.js';
import { NotPendingError } from '../ports/access-approval-tx.js';
import type { AccessRequestStatus } from '../ports/access-request-repository.js';
import type { CostReportService } from '../services/spend/cost-report-service.js';
import { costReportCsv } from '../services/spend/cost-report.js';
import { BadJsonError, readJsonBody, sendJson } from './helpers.js';
import type { AdminDataRoute } from './admin-routes.js';

/**
 * [P45-2 · owner] The console's Access and Costs on the admin session (the ops token is for scripts only now).
 * Same behaviour as the former /ops pages; every action is written to the admin audit log.
 *
 *  GET  /admin/access-requests?status=pending
 *  POST /admin/access-requests/:id/approve | /reject { note } | /reinvite
 *  GET  /admin/costs?view=period|month[&format=csv]
 */
const STATUSES: ReadonlySet<string> = new Set<AccessRequestStatus>(['pending', 'approved', 'rejected', 'invited', 'activated']);

export function adminAccessRoute(svc: Pick<AccessApprovalService, 'list' | 'get' | 'approve' | 'reject' | 'reissueByRequestId'>): AdminDataRoute {
  return async (req, res, url, ctx) => {
    if (!url.pathname.startsWith('/admin/access-requests')) return false;
    const method = req.method ?? 'GET';
    if (method === 'GET' && url.pathname === '/admin/access-requests') {
      const status = url.searchParams.get('status');
      if (status && !STATUSES.has(status)) { sendJson(res, 400, { error: 'validation', message: 'Unknown status.' }); return true; }
      sendJson(res, 200, { requests: await svc.list((status as AccessRequestStatus) ?? undefined) });
      return true;
    }
    const m = /^\/admin\/access-requests\/([^/]+)\/(approve|reject|reinvite)$/.exec(url.pathname);
    if (!m || method !== 'POST') return false;
    const id = decodeURIComponent(m[1]!);
    try {
      const body = (await readJsonBody(req).catch((e) => { if (e instanceof BadJsonError) return {}; throw e; })) as { note?: unknown } | null;
      const by = `${ctx.admin.email} (admin console)`;
      const record = m[2] === 'approve' ? await svc.approve(id, { createdBy: by })
        : m[2] === 'reinvite' ? await svc.reissueByRequestId(id, { createdBy: by })
        : await svc.reject(id, typeof body?.note === 'string' ? body.note.trim() : '', { reviewedBy: by });
      await ctx.audit(`access.${m[2]}`, record.workEmail, { requestId: id, ...(m[2] === 'reject' && typeof body?.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {}) });
      sendJson(res, 200, { request: record });
    } catch (err) {
      if (err instanceof AccessRequestNotFoundError) { sendJson(res, 404, { error: 'not_found' }); return true; }
      if (err instanceof NotPendingError) { sendJson(res, 409, { error: 'not_pending', message: 'This request has already been reviewed.' }); return true; }
      throw err;
    }
    return true;
  };
}

export function adminCostsRoute(costs: Pick<CostReportService, 'report'>): AdminDataRoute {
  return async (req, res, url, ctx) => {
    if ((req.method ?? 'GET') !== 'GET' || url.pathname !== '/admin/costs') return false;
    const view = url.searchParams.get('view') ?? 'period';
    if (view !== 'period' && view !== 'month') { sendJson(res, 400, { error: 'validation', message: 'view must be period or month.' }); return true; }
    const report = await costs.report(view);
    if (url.searchParams.get('format') === 'csv') {
      await ctx.audit('costs.csv_export', null, { view, rows: report.rows.length });
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="tovira-costs-${view}-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
      });
      res.end(costReportCsv(report));
      return true;
    }
    sendJson(res, 200, report);
    return true;
  };
}
