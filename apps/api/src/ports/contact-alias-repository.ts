/**
 * [ALIAS] Learned WhatsApp contact aliases per client, and the rep's own WhatsApp display name.
 * Tenant-isolated (RLS + composite FK), included in export, purged with the account.
 */
/** [P49] 'learned': confirmed on an import. 'previous_name': the name a rename replaced. Both match the next chat and
 *  label its speakers; only a learned alias folds an extracted person into the client on a shared word. */
export type AliasKind = 'learned' | 'previous_name';

export interface ContactAliasRepository {
  /** Add an alias for a client (idempotent on the alias; an existing row keeps its kind). Default kind: learned. */
  add(userId: string, clientId: string, alias: string, kind?: AliasKind): Promise<void>;
  /** Every alias for a client, either kind (import matching and speaker labels). */
  listByClient(userId: string, clientId: string): Promise<string[]>;
  /** [P49] Every alias for a client, with its kind. */
  listByClientWithKind(userId: string, clientId: string): Promise<Array<{ alias: string; kind: AliasKind }>>;
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
