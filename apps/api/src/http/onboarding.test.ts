import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps } from './test-deps.js';

let server: Server;
let base: string;
let deps: TestDeps;

beforeAll(async () => {
  deps = buildInMemoryDeps();
  server = createApiServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function signup(email: string): Promise<{ token: string }> {
  const res = await fetch(`${base}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  return { token: ((await res.json()) as { token: string }).token };
}

interface OnboardingStatus {
  seeded: boolean;
  bookScanReady: boolean;
  seeding: {
    primary: string;
    requiresPasteEntry: boolean;
    steps: { android: string[]; ios: string[] };
  };
  fallbacks: Array<{ kind: string; label: string }>;
}

const status = async (token: string): Promise<OnboardingStatus> =>
  (await (await fetch(`${base}/onboarding/status`, { headers: { authorization: `Bearer ${token}` } })).json()) as OnboardingStatus;

describe('[P5-3] day-one seeding via WhatsApp export', () => {
  it('requires auth', async () => {
    expect((await fetch(`${base}/onboarding/status`)).status).toBe(401);
  });

  it('guides the WhatsApp export flow per platform and never demands paste bulk entry', async () => {
    const { token } = await signup('seed@example.com');
    const s = await status(token);
    expect(s.seeded).toBe(false);
    expect(s.seeding.primary).toBe('whatsapp_export');
    // The whole product exists to kill paste-based data entry.
    expect(s.seeding.requiresPasteEntry).toBe(false);
    // Android = share target; iOS = Files-then-upload.
    expect(s.seeding.steps.android.join(' ')).toMatch(/shar/i);
    expect(s.seeding.steps.ios.join(' ')).toMatch(/files/i);
  });

  it('offers fallbacks so a rep who skips the export is not left with an empty app', async () => {
    const { token } = await signup('skip@example.com');
    const s = await status(token);
    const kinds = s.fallbacks.map((f) => f.kind);
    expect(kinds).toContain('voice_note');
    expect(kinds).toContain('sample_book');
  });

  it('completes the flow in one session: client → import → Book Scan ready', async () => {
    const { token } = await signup('flow@example.com');
    // client created
    const cid = ((await (await fetch(`${base}/clients`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Sara Lee' }),
    })).json()) as { id: string }).id;
    // history imported (P1-4b)
    await fetch(`${base}/clients/${cid}/notes/import`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        consent: true,
        content: [
          '[2026-01-15, 09:00:00] Alex: quote sent',
          '[2026-01-16, 10:00:00] Sara Lee: Can you do bulk pricing?',
        ].join('\n'),
      }),
    });

    const s = await status(token);
    expect(s.seeded).toBe(true);
    expect(s.bookScanReady).toBe(true);

    // Book Scan fires on the seeded history in the same session.
    const scan = (await (await fetch(`${base}/book-scan`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as { items: unknown[] };
    expect(scan.items.length).toBeGreaterThan(0);
  });

  it('keeps each rep\'s seeding state isolated', async () => {
    const a = await signup('a-seed@example.com');
    const b = await signup('b-seed@example.com');
    const cid = ((await (await fetch(`${base}/clients`, {
      method: 'POST',
      headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Sara Lee' }),
    })).json()) as { id: string }).id;
    await fetch(`${base}/clients/${cid}/notes/import`, {
      method: 'POST',
      headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ consent: true, content: '[2026-01-15, 09:00:00] Sara Lee: hi?' }),
    });
    expect((await status(a.token)).seeded).toBe(true);
    expect((await status(b.token)).seeded).toBe(false); // B unaffected
  });
});
