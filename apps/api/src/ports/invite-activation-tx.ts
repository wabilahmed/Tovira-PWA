/** The atomic invite-acceptance step (BETA-6): consume the single-use invite AND set the password +
 *  record terms acceptance + flip the request to 'activated' — all in ONE transaction. The consume is
 *  the serialization point, so the same link activates at most once even under concurrent requests;
 *  if the consume wins nothing (unknown / expired / already consumed), activate returns null and the
 *  transaction makes no changes. */
export interface ActivateInput {
  tokenHash: string;
  now: number;
  passwordHash: string;
  termsVersion: string;
  termsAcceptedIp: string | null;
}

export interface InviteActivationTx {
  /** Returns the activated userId, or null if the token was not consumable (nothing was changed). */
  activate(input: ActivateInput): Promise<{ userId: string } | null>;
}
