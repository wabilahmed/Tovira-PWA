/**
 * [P86 · index audit] Read many clients' rows in ONE query instead of one query per client (the N+1 the audit found
 * on the client list, Today, Find, Book Scan, recall, Monday, the scan, the corpus, the export, erasure and misfile
 * detection: 100 clients meant 100 tenant transactions, 400 round trips). A repository that has `listByClients`
 * answers in one read; one that only reads a client at a time (a minimal test fake) is asked client by client, with
 * the same result. Every requested id is present in the map, an empty list when the client has nothing.
 */
export interface ListsByClient<T> {
  listByClient(userId: string, clientId: string): Promise<T[]>;
  listByClients?(userId: string, clientIds: string[]): Promise<Map<string, T[]>>;
}

export async function listForClients<T>(repo: ListsByClient<T>, userId: string, clientIds: Iterable<string>): Promise<Map<string, T[]>> {
  const ids = [...new Set(clientIds)];
  if (ids.length === 0) return new Map();
  if (typeof repo.listByClients === 'function') {
    const got = await repo.listByClients(userId, ids);
    return new Map(ids.map((id) => [id, got.get(id) ?? []]));
  }
  const out = new Map<string, T[]>();
  for (const id of ids) out.set(id, await repo.listByClient(userId, id)); // fallback: a repository with no batched read
  return out;
}

/** Group rows by client, every requested id present (empty when it has none), each list in the order given. */
export function groupByClient<T extends { clientId: string }>(rows: T[], clientIds: string[]): Map<string, T[]> {
  const out = new Map<string, T[]>(clientIds.map((id) => [id, []]));
  for (const r of rows) out.get(r.clientId)?.push(r);
  return out;
}

/**
 * [P86] The rep's clients by id from ONE read (`listByUser`), instead of `findByIdForUser` once per row in a loop.
 * listByUser returns every client of the rep (no filter, same RLS scope as findByIdForUser), so the lookup answers
 * exactly what the per-id read answered; an id that is not the rep's is simply absent. A repository with no
 * listByUser (a minimal fake) is asked id by id.
 */
export async function clientsById<C extends { id: string }>(
  repo: { findByIdForUser(userId: string, id: string): Promise<C | null>; listByUser?(userId: string): Promise<C[]> },
  userId: string,
  ids: Iterable<string>,
): Promise<Map<string, C>> {
  const want = new Set(ids);
  if (want.size === 0) return new Map();
  if (typeof repo.listByUser === 'function') return new Map((await repo.listByUser(userId)).filter((c) => want.has(c.id)).map((c) => [c.id, c]));
  const out = new Map<string, C>();
  for (const id of want) { const c = await repo.findByIdForUser(userId, id); if (c) out.set(id, c); } // fallback: no listByUser
  return out;
}
