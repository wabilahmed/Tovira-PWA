/**
 * [ALIAS] Learned WhatsApp contact aliases per client, and the rep's own WhatsApp display name.
 * Tenant-isolated (RLS + composite FK), included in export, purged with the account.
 */
export interface ContactAliasRepository {
  /** Add an alias for a client (idempotent on the alias). */
  add(userId: string, clientId: string, alias: string): Promise<void>;
  /** Aliases learned for a client. */
  listByClient(userId: string, clientId: string): Promise<string[]>;
  /** All of a rep's aliases (for export), grouped by client. */
  listByUser(userId: string): Promise<Array<{ clientId: string; alias: string }>>;
  /** In-memory purge on account deletion (pg cascades via the FK). */
  purgeUser(userId: string): Promise<void>;
}

export interface RepNameRepository {
  /** The rep's own WhatsApp display name, or null if not yet known. */
  get(userId: string): Promise<string | null>;
  /** Set/learn the rep's own WhatsApp display name. */
  set(userId: string, whatsappName: string): Promise<void>;
  purgeUser(userId: string): Promise<void>;
}
