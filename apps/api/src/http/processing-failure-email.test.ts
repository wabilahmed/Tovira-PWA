import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createApiServer } from '../server.js';
import { buildInMemoryDeps, type TestDeps, TEST_ADMIN_EMAIL } from './test-deps.js';
import { listenForTest } from '../test-support/listen.js';
import type { ModelClient } from '../ports/model.js';
import type { Transcriber } from '../ports/transcriber.js';
import { failureClassOf } from '../services/access/admin-events.js';

// [P65-6 · owner] When Tovira couldn't read something on our side, the admins get an email in the admin template: the rep,
// the path (chat, voice note, typed note) and the error class. Never the content: no note text, no client name.
const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
let server: Server | null = null;
afterEach(async () => { if (server) await new Promise<void>((r) => server!.close(() => r())); server = null; });
async function start(opts: { modelClient?: ModelClient; transcriber?: Transcriber } = {}): Promise<{ url: string; deps: TestDeps; token: string; clientId: string }> {
  const deps = buildInMemoryDeps({}, opts);
  server = createApiServer(deps);
  const url = await listenForTest(server!);
  const s = (await (await fetch(`${url}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'layla@brokerage.ae', password: 'password123', consent: true }) })).json()) as { token: string };
  const clientId = ((await (await fetch(`${url}/clients`, { method: 'POST', headers: H(s.token), body: JSON.stringify({ name: 'Anjali Mehra' }) })).json()) as { id: string }).id;
  return { url, deps, token: s.token, clientId };
}
const toAdmin = (deps: TestDeps) => deps.emailSender.sent.filter((m) => m.to === TEST_ADMIN_EMAIL && /couldn.t read/i.test(m.subject));
const broken: ModelClient = { complete: async () => ({ text: 'not json at all' }) } as ModelClient;

describe('[P65-6] the admin hears about failures on our side', () => {
  it('a typed note that could not be read: rep, path and error class', async () => {
    const { url, deps, token, clientId } = await start({ modelClient: broken });
    await fetch(`${url}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text: 'SECRETWORD I will send the floor plan by Friday.' }) });
    await deps.runSweep(6);
    const mails = toAdmin(deps);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe("Tovira couldn't read a typed note");
    expect(mails[0]!.text).toContain('Rep: layla@brokerage.ae');
    expect(mails[0]!.text).toContain('Path: typed note');
    expect(mails[0]!.text).toContain('Error: extraction failed');
    expect(mails[0]!.html).toContain('Open Admin'); // the admin template
  });
  it('NEGATIVE: never the content: no note text, no client name', async () => {
    const { url, deps, token, clientId } = await start({ modelClient: broken });
    await fetch(`${url}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text: 'SECRETWORD I will send the floor plan by Friday.' }) });
    await deps.runSweep(6);
    const m = toAdmin(deps)[0]!;
    for (const s of [m.subject, m.text, m.html ?? '']) { expect(s).not.toContain('SECRETWORD'); expect(s).not.toContain('Anjali'); expect(s).not.toContain('floor plan'); }
  });
  it('a voice note whose transcription kept failing: transcription failed', async () => {
    const transcriber = { transcribe: async () => { throw new Error('groq timeout'); } } as unknown as Transcriber;
    const { url, deps, token, clientId } = await start({ transcriber });
    await fetch(`${url}/clients/${clientId}/notes/voice`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/webm' }, body: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(4000).fill(1)]) });
    await deps.runSweep(8);
    const mails = toAdmin(deps);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain('Path: voice note');
    expect(mails[0]!.text).toContain('Error: transcription failed');
  });
  it('NEGATIVE: a note read fine, or one held because the allowance is used up, sends nothing', async () => {
    const { url, deps, token, clientId } = await start();
    await fetch(`${url}/clients/${clientId}/notes/paste`, { method: 'POST', headers: H(token), body: JSON.stringify({ text: 'Called, no answer.' }) });
    await deps.runSweep();
    expect(toAdmin(deps)).toHaveLength(0);
  });
  it('the error classes', () => {
    expect(failureClassOf({ status: 'needs_review', source: 'paste', rawText: 'x' } as never)).toBe('extraction failed');
    expect(failureClassOf({ status: 'needs_review', source: 'voice', rawText: null } as never)).toBe('transcription failed');
    expect(failureClassOf({ status: 'needs_review', source: 'voice', rawText: '' } as never)).toBe('transcription failed');
    expect(failureClassOf({ status: 'transcription_failed', source: 'voice', rawText: null } as never)).toBe('recording missing');
    expect(failureClassOf({ status: 'import_failed', source: 'whatsapp_export', rawText: 'x' } as never)).toBe('import failed');
  });
});
