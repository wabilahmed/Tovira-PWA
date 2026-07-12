import { describe, it, expect } from 'vitest';
import { requestMicrophone } from './microphone.js';

// [P1-3] NEGATIVE: denying the mic must give clear guidance, never crash or
// appear to silently record.
describe('requestMicrophone', () => {
  it('returns not-granted with guidance when getUserMedia is unavailable', async () => {
    const result = await requestMicrophone({} as never);
    expect(result.granted).toBe(false);
    expect(result.guidance).toBeTruthy();
  });

  it('returns not-granted with guidance when permission is denied (no throw)', async () => {
    const mediaDevices = {
      getUserMedia: async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      },
    };
    const result = await requestMicrophone(mediaDevices as never);
    expect(result.granted).toBe(false);
    expect(result.guidance).toMatch(/microphone|denied|enable/i);
    expect(result.stream).toBeUndefined();
  });

  it('returns granted with the stream when permission is allowed', async () => {
    const fakeStream = { id: 'stream' };
    const mediaDevices = { getUserMedia: async () => fakeStream };
    const result = await requestMicrophone(mediaDevices as never);
    expect(result.granted).toBe(true);
    expect(result.stream).toBe(fakeStream);
  });
});
