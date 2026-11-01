import type { IncomingMessage, ServerResponse } from 'node:http';
import { AccessRequestService, AccessRequestValidationError, type RawAccessRequest } from '../services/access/access-request-service.js';
import type { AccessRequestRecord } from '../ports/access-request-repository.js';
import type { RateLimiter } from '../services/security/rate-limiter.js';
import { clientIp, readJsonBody, sendJson, BadJsonError } from './helpers.js';
import type { LeadInviteService } from '../services/leads/lead-invite-service.js';
import type { AdminAuditEntry } from '../ports/admin.js';

export interface AccessRequestRouteOptions {
  service: AccessRequestService;
  /** Per-IP throttle on submissions: counts real submissions and spam (trap hits, malformed bodies); [P63-3] a refused
   *  validation does not count, so a person correcting the form is never locked out. */
  limiter?: RateLimiter;
  /** [P63-3] Per-IP throttle on the invite prefill, separate: loading the form never spends the submit budget. */
  prefillLimiter?: RateLimiter;
  /** Best-effort owner notification (the row is already written before this runs). */
  notify?: (record: AccessRequestRecord) => Promise<void>;
  /** [P58-5] the founder's invite link: its prefill, the locked email, and the token used once */
  leadInvites?: Pick<LeadInviteService, 'leadForToken' | 'prefill' | 'claim'>;
  /** [P58-5] approve a request from the invite link at once (the same approval as the Access tab: the set-password email goes) */
  autoApprove?: (requestId: string) => Promise<void>;
  /** [P58-5] the admin audit log */
  audit?: (e: AdminAuditEntry) => Promise<void>;
  /** [P60] An invited lead approved at once: "joined via your invite" to the admins, in place of the request email. */
  joined?: (record: AccessRequestRecord) => Promise<void>;
}

/** The hidden honeypot field name. A human never sees or fills it; a form-filling bot usually does.
 *  Chosen to look like a real field a bot would complete. */
// [P63-2 · owner] It was 'company_url' (labelled "Company URL"): Chrome's autofill can fill a field that reads like
// "company" with the person's company, hidden or not, and a real request then vanished behind a fake "Thank you". The
// name and label now mean nothing to autofill. The old name is ignored (an old cached form may still send it, filled).
const HONEYPOT_FIELD = 'hp_trap_7';

/** Handle POST /access-request (public, no session). Returns true if it handled the request. */
export async function handleAccessRequestRoute(req: IncomingMessage, res: ServerResponse, opts: AccessRequestRouteOptions): Promise<boolean> {
  const method = req.method ?? 'GET';
  const url = (req.url ?? '/').split('?')[0];
  const prefillRoute = method === 'POST' && url === '/access-request/invite'; // [P58-5]
  if (!(method === 'POST' && url === '/access-request') && !prefillRoute) return false;

  const ip = clientIp(req);

  // Rate limit FIRST. [P63-3] The prefill has its own budget; a submission's is spent by everything except a refused
  // validation (recorded below, once the outcome is known).
  const limiter = prefillRoute ? opts.prefillLimiter : opts.limiter;
  if (limiter) {
    const gate = limiter.check(ip);
    if (gate.limited) {
      sendJson(res, 429, { error: 'rate_limited', message: 'Too many requests. Please wait a little and try again.' }, { 'retry-after': String(gate.retryAfterSec) });
      return true;
    }
    if (prefillRoute) limiter.record(ip);
  }
  const spend = (): void => { if (!prefillRoute) opts.limiter?.record(ip); };

  let body: Record<string, unknown>;
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof BadJsonError) {
      spend(); // malformed: spam, counted
      sendJson(res, 400, { error: 'bad_json', message: 'Could not read the submission.' });
      return true;
    }
    throw err;
  }

  // [P58-5] The invite link's prefill: the lead's name, email, company and job title, or the normal empty form (404).
  // The token comes in the body (never a query string, so it stays out of access logs).
  if (prefillRoute) {
    const p = opts.leadInvites && typeof body.token === 'string' ? await opts.leadInvites.prefill(body.token) : null;
    if (!p) { sendJson(res, 404, { error: 'invalid' }); return true; }
    sendJson(res, 200, p);
    return true;
  }

  // Honeypot: a filled hidden field means a bot. Respond with a neutral success so we don't teach the
  // bot what tripped it; write nothing and notify no one.
  const trap = body[HONEYPOT_FIELD];
  if (typeof trap === 'string' && trap.trim() !== '') {
    console.info('[access-request] honeypot hit: dropped with a neutral 200'); // [P63-2] a count, never the content
    spend(); // a bot: counted
    sendJson(res, 200, { ok: true });
    return true;
  }

  try {
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent']! : null;
    // [P58-5 · owner] From the founder's invite link: the email is the invited address (locked; whatever the form sent
    // is ignored), and once the token is used for this request it is approved at once. An expired, used or unknown token
    // is an ordinary public request, which waits for the admin.
    const token = typeof body.inviteToken === 'string' ? body.inviteToken : null;
    const lead = token && opts.leadInvites ? await opts.leadInvites.leadForToken(token) : null;
    const raw = (lead ? { ...body, workEmail: lead.email!.trim().toLowerCase() } : body) as RawAccessRequest;
    // The row is written here. The notification below is best-effort and must never fail the request.
    const record = await opts.service.submit(raw, { sourceIp: ip, userAgent, invited: lead !== null }); // [P59-1]
    spend(); // a real submission: counted (a refused validation throws above and is not)
    let approved = false;
    if (lead && token && opts.leadInvites && opts.autoApprove) {
      const claimed = await opts.leadInvites.claim(lead, token, record.id);
      if (claimed) {
        const at = Date.now();
        await opts.audit?.({ adminEmail: 'invite link', action: 'lead.requested', target: record.workEmail, detail: { leadId: lead.id, requestId: record.id }, at }).catch(() => undefined);
        try {
          await opts.autoApprove(record.id);
          approved = true;
          await opts.audit?.({ adminEmail: 'invite link', action: 'access.auto_approve', target: record.workEmail, detail: { leadId: lead.id, requestId: record.id }, at }).catch(() => undefined);
        } catch (err) {
          console.warn('auto-approval from an invite link failed; the request waits on the Access tab', err);
        }
      }
    }
    try {
      // [P60] approved at once from an invite: "joined via your invite", never the "please approve" request email
      if (approved && opts.joined) await opts.joined(record);
      else await opts.notify?.(record);
    } catch (err) {
      console.warn('access-request owner notification failed; the request was still recorded', err);
    }
    sendJson(res, 201, { ok: true, id: record.id, approved });
    return true;
  } catch (err) {
    if (err instanceof AccessRequestValidationError) {
      sendJson(res, 400, { error: 'validation', field: err.field, message: err.message });
      return true;
    }
    throw err;
  }
}
