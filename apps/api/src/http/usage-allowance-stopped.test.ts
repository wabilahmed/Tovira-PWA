import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';
import { AudioRetentionService } from '../services/media/audio-retention-service.js';

/**
 * [USAGE-ALLOWANCE · D4/D5] The stopped state at 100% of the monthly allowance: import refused up front,
 * voice notes stored + deferred (and never swept by retention while waiting), and the rep's data export
 * always works. (A fresh server per test so one exhausted account never bleeds into another.)
 */
let server: Server;
let base: string;
let deps: TestDeps;

beforeEach(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
async function signup(email: string): Promise<{ token: string; userId: string }> {
  const b = (await (await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123', consent: true }) })).json()) as { token: string; user: { id: string } };
  return { token: b.token, userId: b.user.id };
}

describe('[USAGE-ALLOWANCE · D4] import is refused at 100%, not queued', () => {
  it('a chat import is refused (402) and NO note is created', async () => {
    const { token, userId } = await signup('imp-exhausted@example.com');
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name: 'Acme' }) })).json()) as { id: string }).id;
    await deps.exhaustAllowance(userId);

    const res = await fetch(`${base}/clients/${clientId}/notes/import`, {
      method: 'POST', headers: H(token),
      body: JSON.stringify({ content: '[1/1/26, 10:00:00] Ahmed: hello', consent: true, firstImportAck: true }),
    });
    expect(res.status).toBe(402);
    expect((await res.json() as { error: string }).error).toBe('allowance_exhausted');
    // Nothing parsed, nothing stored.
    expect(await deps.notes.listByClient(userId, clientId)).toEqual([]);
  });
});

describe('[USAGE-ALLOWANCE · D4] data export always works, even at 100% / paused', () => {
  it('export returns 200 when exhausted', async () => {
    const { token, userId } = await signup('exp-exhausted@example.com');
    await deps.exhaustAllowance(userId);
    expect((await fetch(`${base}/account/export`, { headers: H(token) })).status).toBe(200);
  });
});

describe('[USAGE-ALLOWANCE · D5] a voice note at 100% is stored, deferred, and never swept while waiting', () => {
  it('the recording is kept and transcription waits; the retention sweep never deletes a waiting recording', async () => {
    const { token, userId } = await signup('voice-exhausted@example.com');
    const clientId = ((await (await fetch(`${base}/clients`, { method: 'POST', headers: H(token), body: JSON.stringify({ name: 'Beta' }) })).json()) as { id: string }).id;
    await deps.exhaustAllowance(userId);

    // The recording is captured + stored (capture is not AI); transcription is deferred.
    const audioKey = `audio/${userId}/note1.webm`;
    await deps.storage.put(audioKey, new Uint8Array([1, 2, 3, 4]));
    const note = await deps.notes.create(userId, { clientId, source: 'voice', rawText: '', audioKey, status: 'pending_transcription' });

    await deps.runSweep(); // sweep SKIPS the exhausted rep → transcription does not run

    const after = (await deps.notes.findByIdForUser(userId, note.id))!;
    expect(after.status).toBe('pending_transcription'); // waiting, not failed, not lost
    expect(after.transcribedAt ?? null).toBeNull(); // the retention clock never started
    expect(await deps.storage.exists(audioKey)).toBe(true); // the only copy is intact

    // Even far in the future, the retention sweep deletes NOTHING — it keys on transcribed_at, which is
    // null for a waiting recording.
    const retention = new AudioRetentionService(
      { allUserIds: () => deps.auth.allUserIds(), notes: deps.notes, storage: deps.storage },
      () => Date.now() + 365 * 24 * 60 * 60 * 1000,
    );
    expect(await retention.sweep()).toBe(0);
    expect(await deps.storage.exists(audioKey)).toBe(true);
  });
});
