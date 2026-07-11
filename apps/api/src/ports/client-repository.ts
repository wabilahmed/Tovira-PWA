/**
 * Port: the per-rep client list (the first tenant-scoped table). Every method is
 * scoped to a userId; the Postgres implementation additionally enforces this at
 * the DB via Row-Level Security (P0-4).
 */

export interface ClientRecord {
  id: string;
  userId: string;
  name: string;
  createdAt: number;
}

export interface ClientRepository {
  create(userId: string, name: string): Promise<ClientRecord>;
  listByUser(userId: string): Promise<ClientRecord[]>;
  findByIdForUser(userId: string, id: string): Promise<ClientRecord | null>;
}
