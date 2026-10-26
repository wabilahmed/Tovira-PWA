import type { AdminStore } from '../../ports/admin.js';
import { LegacySecretBox, SecretBox } from './secret-box.js';

/**
 * [P46-6c.1] Deploy-time, idempotent: move every admin TOTP secret sealed with the old OPS_TOKEN-derived key ("v1.")
 * to the dedicated ADMIN_TOTP_KEY ("v2."), so an enrolled admin keeps signing in without enrolling again. A secret the
 * old key cannot open is left exactly as it is and counted as failed (that admin would re-enrol). Never logs a secret.
 */
export async function reencryptAdminTotp({ store, legacySecret, totpKey }: {
  store: Pick<AdminStore, 'listUsers' | 'updateUser'>;
  legacySecret: string | null;
  totpKey: string;
}): Promise<{ reencrypted: number; alreadyCurrent: number; failed: number }> {
  const next = new SecretBox(totpKey);
  const old = legacySecret ? new LegacySecretBox(legacySecret) : null;
  const out = { reencrypted: 0, alreadyCurrent: 0, failed: 0 };
  for (const u of await store.listUsers()) {
    const fields = { totpSecretEnc: u.totpSecretEnc, totpPendingEnc: u.totpPendingEnc };
    const sealed = Object.values(fields).filter((v): v is string => !!v);
    if (sealed.length === 0) continue; // not enrolled: nothing to move
    if (sealed.every((v) => v.startsWith('v2.'))) { out.alreadyCurrent += 1; continue; }
    try {
      if (!old) throw new Error('no legacy key');
      const patch: { totpSecretEnc?: string; totpPendingEnc?: string } = {};
      for (const [k, v] of Object.entries(fields) as Array<[keyof typeof patch, string | null]>) {
        if (v && v.startsWith('v1.')) patch[k] = next.seal(old.open(v));
      }
      await store.updateUser(u.id, patch);
      out.reencrypted += 1;
    } catch {
      out.failed += 1;
    }
  }
  return out;
}
