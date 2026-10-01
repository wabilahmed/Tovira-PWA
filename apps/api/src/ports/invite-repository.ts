/**
 * Port: single-use beta invite tokens (BETA-5/6). A structural copy of password_resets — only the
 * SHA-256 token HASH is stored (the raw token lives only in the email), single-use burn is one atomic
 * UPDATE. Pre-tenant (no RLS; granted to tovira_app — see migration 0073). Creation happens inside the
 * approval transaction (AccessApprovalTx), so this port is read/consume + the reset-guard query.
 */
export interface InviteRecord {
  tokenHash: string;
  accessRequestId: string;
  userId: string;
  expiresAt: number;
  createdBy: string;
}

export interface InviteRepository {
  /** Atomically consume a valid, unexpired, unconsumed invite. Returns the linked ids, or null if the
   *  token is unknown / already consumed / expired. Single-use even under concurrency (one UPDATE). */
  consume(tokenHash: string, nowMs: number): Promise<{ userId: string; accessRequestId: string } | null>;
  /** Does this user have an invite that is still outstanding (unconsumed AND unexpired)? The signal that
   *  an account is invite-pending, used to keep it unreachable by password reset until the invite is used. */
  hasOutstanding(userId: string, nowMs: number): Promise<boolean>;
  /** Is this token currently usable (known, unconsumed, unexpired)? A NON-consuming check so the invite
   *  page can show "this link is invalid/expired" on load without burning the token. */
  peek(tokenHash: string, nowMs: number): Promise<boolean>;
}
