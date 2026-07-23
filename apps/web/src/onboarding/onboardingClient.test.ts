import { describe, it, expect, vi, afterEach } from 'vitest';
import { OnboardingClient } from './onboardingClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

const STATUS = {
  hasClient: true,
  hasNote: true,
  briefReachable: true,
  seeded: true,
  bookScanReady: true,
  nextStep: 'Open a client and generate your first pre-meeting brief.',
  seeding: { primary: 'whatsapp_export', requiresPasteEntry: false, steps: { android: ['a'], ios: ['b'] } },
  fallbacks: [{ kind: 'voice_note', label: 'Record a note' }],
};

afterEach(() => vi.unstubAllGlobals());

describe('OnboardingClient.status', () => {
  it('GETs /onboarding/status with the session cookie and returns the parsed status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, STATUS));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new OnboardingClient().status();
    expect(result).toEqual(STATUS);
    expect(fetchMock).toHaveBeenCalledWith('/onboarding/status', { credentials: 'include' });
  });

  it('returns null on a non-200 (e.g. 401 unauthenticated)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'unauthorized' })));
    expect(await new OnboardingClient().status()).toBeNull();
  });

  it('returns null when the request throws (offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await new OnboardingClient().status()).toBeNull();
  });
});
