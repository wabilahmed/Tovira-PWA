import type { Storage } from '../../ports/storage.js';
import type { ArchiveIndexRepository } from '../../ports/archive-index-repository.js';

/**
 * [TRAINING-ARCHIVE] Retention is INDEFINITE. This sweep ARCHIVES old training-log rows to object
 * storage and removes them from the hot table — it NEVER deletes by age. The corpus exists to build a
 * distillation model two to three years out; it is free to collect now and impossible to recover
 * later, so nothing destroys it. Archival only moves it off the RAM-constrained RDS instance (which
 * also runs pgvector) to cheap object storage, in a form loadable for training later.
 *
 * SAFETY INVARIANTS:
 *  - VERIFY BEFORE REMOVE: a row leaves the hot table ONLY after its archive object write AND index
 *    upsert have both resolved. Never the other way round — a crash leaves rows hot, never lost.
 *  - IDEMPOTENT: objects are keyed by (collection, user, month) and merged by row id, so an
 *    interrupted run re-archives the same rows to the same key (overwrite, no dup) and a run after a
 *    late-arriving row unions rather than overwrites (no loss).
 *  - DISABLED BY DEFAULT + DESTINATION REQUIRED: ageDays <= 0 → no-op; a non-empty destination is
 *    required to enable (enforced at deploy by assertDeployReady), so rows are never removed with
 *    nowhere to put them.
 */
export interface ArchivableRecord {
  id: string;
  createdAt: number;
  promptVersion: string | null;
}

export interface ArchivableCollection<T extends ArchivableRecord> {
  /** 'extraction_logs' | 'corrections' — the object-key path segment. */
  name: string;
  listOlderThan(userId: string, cutoffMs: number): Promise<T[]>;
  deleteByIds(userId: string, ids: string[]): Promise<number>;
}

export interface TrainingArchiveDeps {
  storage: Storage;
  index: ArchiveIndexRepository;
  collections: ArchivableCollection<ArchivableRecord>[];
  allUserIds: () => Promise<string[]>;
  /** Archive rows older than this many days. 0 (or negative) → disabled (archive nothing). */
  ageDays: number;
  /** Object-key prefix / destination. Required (non-empty) when ageDays > 0. */
  destination: string;
}

export interface ArchiveResult {
  enabled: boolean;
  archived: number; // rows moved to object storage + removed from hot
  partitions: number; // object writes
}

const DAY_MS = 24 * 60 * 60 * 1000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function partitionOf(createdAtMs: number): string {
  return new Date(createdAtMs).toISOString().slice(0, 7); // YYYY-MM (UTC)
}

function toNdjson(rows: unknown[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
}

function parseNdjson(bytes: Uint8Array): Array<{ id: string } & Record<string, unknown>> {
  const text = dec.decode(bytes).trim();
  if (!text) return [];
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export class TrainingArchiveService {
  constructor(private readonly deps: TrainingArchiveDeps) {}

  async archive(nowMs: number): Promise<ArchiveResult> {
    const { ageDays, destination } = this.deps;
    if (!ageDays || ageDays <= 0 || !destination) {
      return { enabled: false, archived: 0, partitions: 0 };
    }
    const cutoffMs = nowMs - ageDays * DAY_MS;
    const users = await this.deps.allUserIds();
    let archived = 0;
    let partitions = 0;

    for (const userId of users) {
      for (const coll of this.deps.collections) {
        const rows = await coll.listOlderThan(userId, cutoffMs);
        if (rows.length === 0) continue;

        // Group the hot rows by month partition.
        const byPartition = new Map<string, ArchivableRecord[]>();
        for (const r of rows) {
          const p = partitionOf(r.createdAt);
          (byPartition.get(p) ?? byPartition.set(p, []).get(p)!).push(r);
        }

        for (const [partition, partRows] of byPartition) {
          const key = `${destination}/${coll.name}/${userId}/${partition}.ndjson`;

          // Merge with anything already archived to this key (idempotency + no-loss on late arrivals).
          const merged = new Map<string, unknown>();
          if (await this.deps.storage.exists(key)) {
            for (const existing of parseNdjson(await this.deps.storage.get(key))) merged.set(existing.id, existing);
          }
          for (const r of partRows) merged.set(r.id, r);

          // VERIFY BEFORE REMOVE: write the object + index the partition, THEN delete the hot rows.
          await this.deps.storage.put(key, enc.encode(toNdjson([...merged.values()])));
          await this.deps.index.upsert(userId, { collection: coll.name, partition, objectKey: key, rowCount: merged.size });
          const removed = await coll.deleteByIds(userId, partRows.map((r) => r.id));

          archived += removed;
          partitions += 1;
        }
      }
    }
    return { enabled: true, archived, partitions };
  }
}
