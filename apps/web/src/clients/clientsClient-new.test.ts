import { describe, it, expect, vi, afterEach } from 'vitest';
import { ClientsClient } from './clientsClient.js';

// [P57] The New client calls: a duplicate is a question (409 → duplicate, never an error the rep can't act on), and a
// voice draft that can't be transcribed keeps the recording on the phone.
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('[P57] createNew', () => {
  it('sends the fields with checkDuplicate, and returns the client', async () => {
    const f = vi.fn(async () => json(201, { id: 'c1', name: 'Sara Khan', phone: null, createdAt: 1 }));
    vi.stubGlobal('fetch', f);
    const r = await new ClientsClient('').createNew({ name: 'Sara Khan', company: ' Emaar ', industry: 'property', title: '', phone: '' });
    expect(r).toMatchObject({ ok: true, client: { id: 'c1' } });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ name: 'Sara Khan', checkDuplicate: true, company: 'Emaar', industry: 'property' });
  });
  it('a 409 is the duplicate question, with the existing client', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: 'duplicate_client', message: 'You already have Sara Khan. Add this to Sara Khan instead?', client: { id: 'c1', name: 'Sara Khan' }, match: 'name' })));
    expect(await new ClientsClient('').createNew({ name: 'sara khan' })).toEqual({ ok: false, duplicate: { id: 'c1', name: 'Sara Khan' }, message: 'You already have Sara Khan. Add this to Sara Khan instead?' });
  });
  it('NEGATIVE: a validation refusal carries the server\'s message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(400, { error: 'validation', message: 'Choose an industry from the list.' })));
    expect(await new ClientsClient('').createNew({ name: 'x', industry: 'astrology' })).toEqual({ ok: false, message: 'Choose an industry from the list.' });
  });
});

describe('[P57] voiceDraft', () => {
  it('returns the transcript and the suggestion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { transcript: 'Met Omar.', suggestion: { name: 'Omar', company: null, phone: null } })));
    expect(await new ClientsClient('').voiceDraft(new Uint8Array([1]))).toEqual({ ok: true, transcript: 'Met Omar.', suggestion: { name: 'Omar', company: null, phone: null } });
  });
  it('NEGATIVE: unavailable, offline, or AI paused: a message, and the recording stays here', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(503, { error: 'transcription_unavailable', message: "Couldn't transcribe that just now. Your recording is kept on this phone. Try again." })));
    expect(await new ClientsClient('').voiceDraft(new Uint8Array([1]))).toMatchObject({ ok: false, kind: 'unavailable' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await new ClientsClient('').voiceDraft(new Uint8Array([1]))).toMatchObject({ ok: false, kind: 'unavailable', message: expect.stringMatching(/kept on this phone/) });
    vi.stubGlobal('fetch', vi.fn(async () => json(402, { error: 'ai_unavailable', reason: 'allowance' })));
    expect(await new ClientsClient('').voiceDraft(new Uint8Array([1]))).toMatchObject({ ok: false, kind: 'paused' });
  });
});
