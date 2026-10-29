import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../services/auth/auth-service.js';
import type { ClientRepository, ClientOutcome } from '../ports/client-repository.js';
import type { ClientPointerRepository } from '../ports/client-pointer-repository.js';
import { BadJsonError, extractToken, readJsonBody, sendJson } from './helpers.js';
import { NO_RESTRICTION, type Restriction } from '../services/erasure/restriction.js';
import { canonicalPhone } from '../services/clients/phone.js';
import type { ContactAliasRepository } from '../ports/contact-alias-repository.js';
import { INDUSTRIES, type Industry } from '../ports/access-request-repository.js';
import { phonesMatch } from '../services/import/misfile.js';

/** [P49] The longest client name a rep can save. */
export const MAX_CLIENT_NAME = 80;
const foldName = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Handle a /clients or /clients/:id request. Returns true if it handled it. */
export async function handleClientRoute(
  req: IncomingMessage,
  res: ServerResponse,
  auth: AuthService,
  clients: ClientRepository,
  pointers?: ClientPointerRepository,
  /** [TASK 2] Active erasure-window restriction — pointers citing a restricted counterparty (or all of a
   *  restricted client's pointers) are withheld from the thread card. Absent → no restriction. */
  restriction?: { forUser(userId: string): Promise<Restriction> },
  /** [P47-1] After any outcome change (set, undo, restore): keep the Ledger's "Won after a suggestion" in step. */
  onOutcomeChanged?: (userId: string, clientId: string) => Promise<void>,
  /** [P49] Where a rename keeps the old name (as a previous name), so the next chat finds the same client. */
  aliases?: Pick<ContactAliasRepository, 'add'>,
  /** [P49] After a rename: re-attribute the client's folded-in people entries to the new name. */
  onRenamed?: (userId: string, clientId: string, oldName: string, newName: string) => Promise<void>,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0]!;
  if (path !== '/clients' && !path.startsWith('/clients/')) return false;

  const identity = await auth.authenticate(extractToken(req));
  if (!identity) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }
  const userId = identity.userId;
  /** [P49] A client under an active erasure restriction can't be renamed: the page hides "Edit name". */
  const locked = async <T extends { name: string }>(list: T[]): Promise<Array<T & { nameLocked?: true }>> => {
    const r = restriction ? await restriction.forUser(userId) : NO_RESTRICTION;
    return r.active ? list.map((c) => (r.restrictsWho(c.name) ? { ...c, nameLocked: true as const } : c)) : list;
  };

  try {
    if (method === 'POST' && path === '/clients') {
      const body = (await readJsonBody(req)) as { name?: unknown; phone?: unknown; title?: unknown; email?: unknown; company?: unknown; industry?: unknown; checkDuplicate?: unknown; confirmDuplicate?: unknown };
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        sendJson(res, 400, { error: 'validation', message: 'A client name is required.' });
        return true;
      }
      // [P57-3] the same cap as a rename
      if (name.length > MAX_CLIENT_NAME) {
        sendJson(res, 400, { error: 'validation', message: `Keep the name to ${MAX_CLIENT_NAME} characters or fewer.` });
        return true;
      }
      // [P57-3] industry from the sign-up form's list; company as typed
      let industry: Industry | null = null;
      if (typeof body.industry === 'string' && body.industry.trim()) {
        if (!(INDUSTRIES as readonly string[]).includes(body.industry)) { sendJson(res, 400, { error: 'validation', message: 'Choose an industry from the list.' }); return true; }
        industry = body.industry as Industry;
      }
      const company = typeof body.company === 'string' && body.company.trim() ? body.company.trim().slice(0, 120) : null;
      // [P46-4] Validated and stored in the canonical international form; never a guessed country code.
      let phone: string | null = null;
      if (typeof body.phone === 'string' && body.phone.trim()) {
        const p = canonicalPhone(body.phone);
        if (!p.ok) { sendJson(res, 400, { error: 'validation', message: p.message }); return true; }
        phone = p.phone;
      }
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null;
      const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
      // [P57-3 · owner] Same name (folded) or same phone: a question, never a merge. Only for callers that ask
      // (New client); "Create new" sends confirmDuplicate and makes a separate client.
      if (body.checkDuplicate === true && body.confirmDuplicate !== true) {
        const all = await clients.listByUser(userId);
        const byName = all.find((c) => foldName(c.name) === foldName(name));
        const byPhone = phone ? all.find((c) => c.phone && phonesMatch(c.phone, phone!)) : undefined;
        const dup = byName ?? byPhone;
        if (dup) {
          sendJson(res, 409, { error: 'duplicate_client', message: `You already have ${dup.name}. Add this to ${dup.name} instead?`, client: { id: dup.id, name: dup.name }, match: byName ? 'name' : 'phone' });
          return true;
        }
      }
      // [P57-3] the erasure guard as everywhere else (P49): a client who is a restricted person comes back name-locked, and
      // its notes are withheld from the model at extraction (restrictNote). Creating one is allowed, as before.
      const [created] = await locked([await clients.create(userId, name, phone, title, email, { company, industry })]);
      sendJson(res, 201, created);
      return true;
    }

    // [OUTCOME-3 / FOLLOWUP-1] The rep confirm control: won / lost / still open.
    //  - won / lost are real OUTCOME statements → outcome_source='rep', which the nightly silence rule
    //    (OUTCOME-2) must never overwrite.
    //  - "still open" is a statement about the PRESENT, not the outcome. It resets the going-quiet
    //    clock (a snooze) and leaves outcome_source UNSET, so the client stays eligible for inference
    //    later — a rep saying a deal is alive in March is not saying it can never be inferred lost in
    //    December. Source is left unset (null) rather than 'inferred': 'inferred' would falsely
    //    attribute a rep tap to the system, and null == "no outcome on record" is the honest state.
    // Reversible — a rep can POST a different outcome later.
    if (method === 'POST' && path.startsWith('/clients/') && path.endsWith('/outcome')) {
      const id = decodeURIComponent(path.slice('/clients/'.length, -'/outcome'.length));
      const existing = await clients.findByIdForUser(userId, id);
      if (!existing) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const body = (await readJsonBody(req)) as { outcome?: unknown; previous?: unknown };
      const choice = typeof body.outcome === 'string' ? body.outcome : '';
      // [P36-7] Undo: put back EXACTLY the outcome the rep had (value, source, time). Unlike "still open" this
      // never touches the going-quiet clock — an undo is not a sign of life from the client.
      if (choice === 'restore') {
        const p = (body.previous ?? {}) as { outcome?: unknown; source?: unknown; changedAt?: unknown };
        const outcomes: readonly string[] = ['open', 'won', 'lost_confirmed', 'lost_inferred'];
        const sources: readonly unknown[] = ['rep', 'inferred', null];
        const at = p.changedAt;
        const atOk = at === null || (typeof at === 'number' && Number.isFinite(at) && at >= 0 && at <= Date.now());
        if (typeof p.outcome !== 'string' || !outcomes.includes(p.outcome) || !sources.includes(p.source ?? null) || !atOk || (p.outcome !== 'open' && (at === null || p.source == null))) {
          sendJson(res, 400, { error: 'validation', message: 'previous must be the outcome, source and time to restore.' });
          return true;
        }
        if (p.outcome === 'open' && (p.source ?? null) === null) await clients.clearOutcome(userId, id, 'rep', Date.now());
        else await clients.setOutcome(userId, id, p.outcome as ClientOutcome, p.source as 'rep' | 'inferred', at as number);
        await onOutcomeChanged?.(userId, id);
        sendJson(res, 200, await clients.findByIdForUser(userId, id));
        return true;
      }
      const mapped: ClientOutcome | null =
        choice === 'won' ? 'won' : choice === 'lost' ? 'lost_confirmed' : choice === 'open' ? 'open' : null;
      if (mapped === null) {
        sendJson(res, 400, { error: 'validation', message: "outcome must be 'won', 'lost', or 'open'." });
        return true;
      }
      if (mapped === 'open') {
        await clients.clearOutcome(userId, id, 'rep', Date.now()); // snooze: untouched default; history actor 'rep'
        await clients.touch(userId, id);        // reset the going-quiet clock
      } else {
        await clients.setOutcome(userId, id, mapped, 'rep', Date.now());
      }
      await onOutcomeChanged?.(userId, id);
      sendJson(res, 200, await clients.findByIdForUser(userId, id));
      return true;
    }

    // [LEAD-STATUS] The rep's MANUAL pipeline label: warm / cold / done, or null = Unsorted.
    //  - This is the ONLY writer of lead_status in the whole system. Nothing automatic calls it —
    //    not extraction, import, the going-cold signals, pointers or the retrospective. A status only
    //    ever changes because a rep tapped it here. (A test runs all of those and asserts it unchanged.)
    //  - A rep may move a client to ANY status at any time, including back to Unsorted (null) — so null
    //    is an accepted value, not a missing one. `status` absent from the body is a validation error;
    //    `status: null` is the explicit "move to Unsorted" action.
    //  - Non-AI, no allowance use: it lives on the /clients path, after the billing gate, so it works in
    //    trial / active / payment_failed and is never metered against the AI spend cap.
    if (method === 'POST' && path.startsWith('/clients/') && path.endsWith('/lead-status')) {
      const id = decodeURIComponent(path.slice('/clients/'.length, -'/lead-status'.length));
      const existing = await clients.findByIdForUser(userId, id);
      if (!existing) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const body = (await readJsonBody(req)) as { status?: unknown; restoreChangedAt?: unknown };
      // Accept exactly the three labels or an explicit null; reject anything else (including a missing
      // key, a string like 'unsorted', or a number) so a typo never silently clears a rep's label.
      if (!('status' in body) || !(body.status === null || body.status === 'warm' || body.status === 'cold' || body.status === 'done')) {
        sendJson(res, 400, { error: 'validation', message: "status must be 'warm', 'cold', 'done', or null." });
        return true;
      }
      // [P36-7] Undo carries the previous status's own changed-at, so the restore is exact.
      const restoreAt = body.restoreChangedAt;
      if (restoreAt !== undefined && restoreAt !== null && !(typeof restoreAt === 'number' && Number.isFinite(restoreAt) && restoreAt >= 0 && restoreAt <= Date.now())) {
        sendJson(res, 400, { error: 'validation', message: 'restoreChangedAt must be a past time in ms.' });
        return true;
      }
      await clients.setLeadStatus(userId, id, body.status, typeof restoreAt === 'number' ? restoreAt : Date.now());
      sendJson(res, 200, await clients.findByIdForUser(userId, id));
      return true;
    }

    // [P49] Rename a client. Trimmed, never empty, at most MAX_CLIENT_NAME. Another client with the same name is a
    // warning the rep confirms (confirmDuplicate), never a merge. The old name is kept as a previous name, so the next
    // chat (still labelled the old way in WhatsApp) links to this client; the change is recorded (old, new, when).
    // Undo is a rename back. Stored messages and receipts are never touched: a quote keeps the name it was said with.
    const renameMatch = method === 'POST' ? /^\/clients\/([^/]+)\/name$/.exec(path) : null;
    if (renameMatch) {
      const id = decodeURIComponent(renameMatch[1]!);
      const existing = await clients.findByIdForUser(userId, id);
      if (!existing) { sendJson(res, 404, { error: 'not_found' }); return true; }
      const r = restriction ? await restriction.forUser(userId) : NO_RESTRICTION;
      if (r.active && r.restrictsWho(existing.name)) {
        sendJson(res, 403, { error: 'restricted', message: 'This client can\'t be renamed while a privacy request is reviewed.' });
        return true;
      }
      const body = (await readJsonBody(req)) as { name?: unknown; confirmDuplicate?: unknown };
      const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
      if (!name) { sendJson(res, 400, { error: 'validation', message: 'A client name is required.' }); return true; }
      if (name.length > MAX_CLIENT_NAME) { sendJson(res, 400, { error: 'validation', message: `Keep the name to ${MAX_CLIENT_NAME} characters or fewer.` }); return true; }
      if (name !== existing.name && body.confirmDuplicate !== true) {
        const twin = (await clients.listByUser(userId)).find((c) => c.id !== id && foldName(c.name) === foldName(name));
        if (twin) { sendJson(res, 409, { error: 'duplicate_name', message: `You already have a client called ${twin.name}. Save anyway?` }); return true; }
      }
      const done = await clients.rename(userId, id, name, Date.now());
      if (!done) { sendJson(res, 404, { error: 'not_found' }); return true; }
      if (done.oldName !== name && aliases) await aliases.add(userId, id, done.oldName, 'previous_name');
      if (done.oldName !== name && onRenamed) await onRenamed(userId, id, done.oldName, name);
      sendJson(res, 200, { client: await clients.findByIdForUser(userId, id), previousName: done.oldName });
      return true;
    }

    // [P58-P2 · owner] Company and industry, editable in the client's Edit sheet. Empty clears either; the phone and
    // everything else are untouched. Restricted like a rename.
    const detailsMatch = method === 'POST' ? /^\/clients\/([^/]+)\/details$/.exec(path) : null;
    if (detailsMatch) {
      const id = decodeURIComponent(detailsMatch[1]!);
      const existing = await clients.findByIdForUser(userId, id);
      if (!existing) { sendJson(res, 404, { error: 'not_found' }); return true; }
      const r = restriction ? await restriction.forUser(userId) : NO_RESTRICTION;
      if (r.active && r.restrictsWho(existing.name)) {
        sendJson(res, 403, { error: 'restricted', message: 'This client can\'t be edited while a privacy request is reviewed.' });
        return true;
      }
      const body = (await readJsonBody(req)) as { company?: unknown; industry?: unknown };
      let industry: Industry | null = null;
      if (typeof body.industry === 'string' && body.industry.trim()) {
        if (!(INDUSTRIES as readonly string[]).includes(body.industry)) { sendJson(res, 400, { error: 'validation', message: 'Choose an industry from the list.' }); return true; }
        industry = body.industry as Industry;
      }
      const company = typeof body.company === 'string' && body.company.trim() ? body.company.trim().slice(0, 120) : null;
      await clients.setDetails(userId, id, { company, industry });
      const [updated] = await locked([(await clients.findByIdForUser(userId, id))!]);
      sendJson(res, 200, updated);
      return true;
    }

    // [P4-7] Set (or clear) a client's phone. RLS/ownership scopes the row: a
    // rep can never edit another rep's client, so a miss is a 404.
    if (method === 'PATCH' && path.startsWith('/clients/') && !path.slice('/clients/'.length).includes('/')) {
      const id = decodeURIComponent(path.slice('/clients/'.length));
      const existing = await clients.findByIdForUser(userId, id);
      if (!existing) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const body = (await readJsonBody(req)) as { phone?: unknown };
      // [P46-4] Validated and stored canonical (+971503863103); a refused number changes nothing. Empty clears it.
      let phone: string | null = null;
      if (typeof body.phone === 'string' && body.phone.trim()) {
        const p = canonicalPhone(body.phone);
        if (!p.ok) { sendJson(res, 400, { error: 'validation', message: p.message }); return true; }
        phone = p.phone;
      }
      await clients.setPhone(userId, id, phone);
      sendJson(res, 200, await clients.findByIdForUser(userId, id));
      return true;
    }

    if (method === 'GET' && path === '/clients') {
      // The rep's full client list, recents-first. Search is done CLIENT-SIDE in the PWA
      // (name + phone + email), so this endpoint takes NO query — a client name/phone is personal data
      // and must never ride in a URL (it would land in CloudFront / ALB access logs). The legacy ?q=
      // name-search was removed in P12. (ClientRepository.search still exists for the meeting parser's
      // server-side name match — that never puts a name in a URL.)
      sendJson(res, 200, { clients: await locked(await clients.listByUser(userId)) });
      return true;
    }

    // [POINTERS · D8] the client's current pointer set, for the thread card.
    const pointersMatch = method === 'GET' ? /^\/clients\/([^/]+)\/pointers$/.exec(path) : null;
    if (pointersMatch) {
      const id = decodeURIComponent(pointersMatch[1]!);
      const set = pointers ? await pointers.getForClient(userId, id) : null;
      // [TASK 2] Withhold pointers that cite a restricted counterparty; if the client itself is the
      // restricted party, withhold the whole set (it is a surface, not the stored record).
      const r = restriction ? await restriction.forUser(userId) : NO_RESTRICTION;
      if (r.active && set) {
        const client = await clients.findByIdForUser(userId, id);
        const clientRestricted = client ? r.restrictsWho(client.name) : false;
        const visible = clientRestricted ? [] : set.pointers.filter((p) => !r.restrictsText(p.text));
        sendJson(res, 200, { pointers: visible, disclosure: clientRestricted ? null : set.retrospectiveDisclosure });
        return true;
      }
      sendJson(res, 200, { pointers: set?.pointers ?? [], disclosure: set?.retrospectiveDisclosure ?? null });
      return true;
    }

    if (method === 'GET' && path.startsWith('/clients/')) {
      const id = decodeURIComponent(path.slice('/clients/'.length));
      const client = await clients.findByIdForUser(userId, id);
      if (!client) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      sendJson(res, 200, (await locked([client]))[0]);
      return true;
    }

    sendJson(res, 405, { error: 'method_not_allowed' });
    return true;
  } catch (err) {
    if (err instanceof BadJsonError) {
      sendJson(res, 400, { error: 'bad_request', message: 'Invalid request body.' });
      return true;
    }
    throw err;
  }
}
