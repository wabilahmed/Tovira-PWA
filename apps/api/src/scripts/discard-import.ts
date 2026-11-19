/**
 * [P79-EMERGENCY · owner, 19 Nov] Discard one import completely: a 28,357-message test chat from the WhatsApp number
 * ran for hours (twice in parallel) and is now parked by the production AI pause. "Discard this import completely:
 * cancel both runs, remove it from the queue, mark the note discarded. Confirm nothing for it can restart."
 *
 * What --apply does, for the rep (--only-user) and the ids given (--ids <noteId>,<batchId>):
 *  - the NOTE goes through the import-undo path (NoteMoveTx.undo, as the app's Undo import): the note row and every
 *    fact it produced are deleted in one transaction, with the move audit row. Nothing is left to queue or retry;
 *  - its CLIENT is deleted too when this import created it and it has no other note (else it is kept, and listed);
 *  - the staged BATCH (the WhatsApp "Got your chat" link's files) is deleted, so the link can't start it again.
 * The runs: there is no worker to cancel. Each run stops at its next model call while AI is paused (the log shows
 * "usage gate refused … re-queued"); a run that later finds its note gone writes nothing.
 *
 * The check, printed by every run (dry or apply), metadata only: the note (status, source, messages, attempts), its
 * client's note count, the batch's staged files, and every note of this rep still queued (pending or extracting) with
 * its message count. After --apply: note none, batch files 0, and no queued note over the emergency limit.
 *
 *   Dry run: scripts/ops/run-backfill.sh --script discard-import --only-user <userId> --ids <noteId>,<batchId>
 *   Apply:   scripts/ops/run-backfill.sh --script discard-import --only-user <userId> --ids <noteId>,<batchId> --apply
 */
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/pool.js';
import { withTenant } from '../db/tenant.js';
import { EMERGENCY_MAX_MESSAGES } from '../services/import/long-chat.js';

export interface DiscardArgs { userId: string; noteId: string; batchId: string; apply: boolean }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = /^[A-Za-z0-9-]{4,80}$/;

export function parseDiscardArgs(argv: string[]): DiscardArgs {
  let userId: string | null = null; let ids: string[] | null = null; let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--only-user') userId = (argv[++i] ?? '').trim();
    else if (a === '--ids') ids = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--apply') apply = true;
    else throw new Error(`unknown argument: ${a} (expected --only-user <userId>, --ids <noteId>,<batchId>, --apply)`);
  }
  if (!userId || !UUID.test(userId)) throw new Error('--only-user <userId> is required (the rep the import belongs to)');
  if (!ids || ids.length !== 2) throw new Error('--ids <noteId>,<batchId> is required: the note, then the staged batch');
  const [noteId, batchId] = ids as [string, string];
  if (!UUID.test(noteId)) throw new Error(`--ids: the first id must be the note id (a uuid), got "${noteId}"`);
  if (!BATCH.test(batchId)) throw new Error(`--ids: the second id must be the batch id (e.g. wa-…), got "${batchId}"`);
  return { userId, noteId, batchId, apply };
}

export interface NoteInfo { status: string; source: string; clientId: string; messages: number; attempts: number; claimedAt: string | null }
export interface DiscardDeps {
  note(userId: string, noteId: string): Promise<NoteInfo | null>;
  queued(userId: string): Promise<Array<{ id: string; status: string; messages: number }>>;
  clientNotes(userId: string, clientId: string): Promise<number>;
  undo(userId: string, noteId: string): Promise<{ ok: boolean; error?: string }>;
  deleteClientIfEmpty(userId: string, clientId: string): Promise<boolean>;
  batchKeys(userId: string, batchId: string): Promise<string[]>;
  deleteKey(key: string): Promise<void>;
}

export interface DiscardCheck { note: NoteInfo | null; clientNotes: number | null; batchFiles: number; queued: Array<{ id: string; status: string; messages: number }>; queuedOverLimit: number }
export interface DiscardResult { before: DiscardCheck; after: DiscardCheck | null; actions: string[] }

async function check(d: DiscardDeps, a: DiscardArgs): Promise<DiscardCheck> {
  const note = await d.note(a.userId, a.noteId);
  const queued = await d.queued(a.userId);
  return {
    note,
    clientNotes: note ? await d.clientNotes(a.userId, note.clientId) : null,
    batchFiles: (await d.batchKeys(a.userId, a.batchId)).length,
    queued,
    queuedOverLimit: queued.filter((q) => q.messages > EMERGENCY_MAX_MESSAGES).length,
  };
}

export async function runDiscardImport(d: DiscardDeps, a: DiscardArgs): Promise<DiscardResult> {
  const before = await check(d, a);
  if (before.note && before.note.source !== 'whatsapp_export') throw new Error(`the note is a ${before.note.source} note, not an import: nothing was changed`);
  if (!before.note && before.batchFiles === 0) throw new Error('neither the note nor the batch exists for this rep: nothing to discard (check the ids)');
  if (!a.apply) return { before, after: null, actions: [] };
  const actions: string[] = [];
  if (before.note) {
    const u = await d.undo(a.userId, a.noteId);
    if (!u.ok) throw new Error(`the note could not be removed (${u.error ?? 'unknown'}): nothing else was changed`);
    actions.push('note removed (import undo: the note and its facts, in one transaction)');
    actions.push((await d.deleteClientIfEmpty(a.userId, before.note.clientId)) ? 'client removed (it had no other note)' : 'client kept (it has other notes)');
  }
  const keys = await d.batchKeys(a.userId, a.batchId);
  for (const k of keys) await d.deleteKey(k);
  actions.push(`staged batch removed (${keys.length} file(s))`);
  return { before, after: await check(d, a), actions };
}

const show = (tag: string, label: string, c: DiscardCheck): void => {
  console.log(`${tag} ${label}: note ${c.note ? `${c.note.status} · ${c.note.source} · ${c.note.messages} messages · ${c.note.attempts} attempt(s) · claimed ${c.note.claimedAt ?? 'no'}` : 'none'} · client notes ${c.clientNotes ?? '-'} · batch files ${c.batchFiles}`);
  console.log(`${tag} ${label}: this rep's queued notes (pending or extracting) ${c.queued.length}, over ${EMERGENCY_MAX_MESSAGES} messages ${c.queuedOverLimit}${c.queued.map((q) => `\n${tag}   ${q.id} ${q.status} ${q.messages} messages`).join('')}`);
};

async function main(): Promise<void> {
  const a = parseDiscardArgs(process.argv.slice(2));
  const { loadConfig } = await import('../config.js');
  const c = await import('../container.js');
  const config = loadConfig();
  const appPool = createPool(config.appDatabaseUrl);
  const storage = c.createStorage(config);
  const move = c.createNoteMoveTx(config, appPool, undefined as never, undefined as never, undefined as never, undefined as never, undefined as never);
  const deps: DiscardDeps = {
    note: (u, id) => withTenant(appPool, u, async (q) => {
      const { rows } = await q.query(`SELECT status, source, client_id, COALESCE(jsonb_array_length(messages), 0) AS n, sweep_attempts, claimed_at FROM notes WHERE id = $1`, [id]);
      const r = rows[0];
      return r ? { status: String(r.status), source: String(r.source), clientId: String(r.client_id), messages: Number(r.n), attempts: Number(r.sweep_attempts), claimedAt: r.claimed_at ? new Date(r.claimed_at as string).toISOString() : null } : null;
    }),
    queued: (u) => withTenant(appPool, u, async (q) => {
      const { rows } = await q.query(`SELECT id, status, COALESCE(jsonb_array_length(messages), 0) AS n FROM notes WHERE status IN ('pending_transcription', 'pending_extraction', 'extracting') ORDER BY created_at`);
      return rows.map((r) => ({ id: String(r.id), status: String(r.status), messages: Number(r.n) }));
    }),
    clientNotes: (u, cid) => withTenant(appPool, u, async (q) => Number((await q.query(`SELECT count(*)::int AS n FROM notes WHERE client_id = $1`, [cid])).rows[0]!.n)),
    undo: async (u, id) => { const r = await move.undo(u, id); return r.ok ? { ok: true } : { ok: false, error: r.error }; },
    deleteClientIfEmpty: (u, cid) => withTenant(appPool, u, async (q) => (await q.query(`DELETE FROM clients WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM notes WHERE client_id = $1) RETURNING id`, [cid])).rows.length > 0),
    batchKeys: (u, b) => storage.list(`bulk-import/${u}/${b}/`),
    deleteKey: (k) => storage.delete(k),
  };
  const tag = '[discard-import]';
  try {
    const r = await runDiscardImport(deps, a);
    console.log(`${tag} ${a.apply ? 'APPLY' : 'DRY RUN'} rep ${a.userId} note ${a.noteId} batch ${a.batchId}`);
    show(tag, 'before', r.before);
    for (const x of r.actions) console.log(`${tag} done: ${x}`);
    if (r.after) show(tag, 'after', r.after);
    if (!a.apply) console.log(`${tag} DRY RUN: nothing changed. To discard: the same command with --apply.`);
    else if (r.after && (r.after.note || r.after.batchFiles > 0 || r.after.queuedOverLimit > 0)) { console.log(`${tag} CHECK FAILED: something is left (see "after")`); process.exitCode = 2; }
    else console.log(`${tag} CHECK PASSED: note none, batch files 0, no queued note over ${EMERGENCY_MAX_MESSAGES} messages`);
  } finally {
    await appPool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[discard-import] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
