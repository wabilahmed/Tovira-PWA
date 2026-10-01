import { describe, it, expect } from 'vitest';
import { isWebm, isOgg, isAllowedImage, isAppRecordingContainer, looksLikeAudio } from './sniff.js';

// Build a byte buffer from a hex/ascii spec.
const bytes = (...parts: Array<number[] | string>): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p));
  return Uint8Array.from(out);
};
const ftyp = (brand: string): Uint8Array => bytes([0x00, 0x00, 0x00, 0x20], 'ftyp', brand);

const F = {
  webm: bytes([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]),
  m4a: ftyp('M4A '), // iPhone voice memo / Safari recording
  mp4generic: ftyp('isom'), // generic/video mp4
  heic: ftyp('heic'), // iPhone photo
  ogg: bytes('OggS', [0x00, 0x02]), // WhatsApp voice note (Opus in Ogg)
  mp3: bytes('ID3', [0x03, 0x00]),
  wav: bytes('RIFF', [0x24, 0x00, 0x00, 0x00], 'WAVE'),
  flac: bytes('fLaC', [0x00]),
  amr: bytes('#!AMR', [0x0a]),
  aac: bytes([0xff, 0xf1, 0x50, 0x80]),
  png: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: bytes([0xff, 0xd8, 0xff, 0xe0]),
  webpImage: bytes('RIFF', [0x1a, 0x00, 0x00, 0x00], 'WEBP'),
  zip: bytes('PK', [0x03, 0x04]),
  text: bytes('[2024-01-01, 10:00:00] Dana: hello'),
};

describe('[VOICE-GATE] media magic-byte sniff', () => {
  it('voice accepts ONLY the app recorder containers (WebM + any MP4/ISO-BMFF)', () => {
    expect(isAppRecordingContainer(F.webm)).toBe(true);
    expect(isAppRecordingContainer(F.m4a)).toBe(true); // Safari/iOS in-app recording
    expect(isAppRecordingContainer(F.mp4generic)).toBe(true);
    for (const k of ['ogg', 'mp3', 'wav', 'flac', 'amr', 'aac', 'png', 'jpeg', 'zip', 'text'] as const) {
      expect(isAppRecordingContainer(F[k]), `${k} must NOT be accepted by the voice route`).toBe(false);
    }
  });

  it('the WhatsApp voice-note container (Ogg/Opus) is rejected by the voice route — the target', () => {
    expect(isOgg(F.ogg)).toBe(true);
    expect(isAppRecordingContainer(F.ogg)).toBe(false);
  });

  it('images allow-list accepts ONLY PNG/JPEG/WebP/HEIC — not audio (incl. m4a) or anything else', () => {
    for (const k of ['png', 'jpeg', 'webpImage', 'heic'] as const) expect(isAllowedImage(F[k]), `${k} should be an allowed image`).toBe(true);
    for (const k of ['webm', 'm4a', 'mp4generic', 'ogg', 'mp3', 'wav', 'flac', 'amr', 'aac', 'zip', 'text'] as const) {
      expect(isAllowedImage(F[k]), `${k} must NOT pass the image allow-list`).toBe(false);
    }
  });

  it('import audio-reject catches every audio container (incl. iPhone m4a + WhatsApp Ogg), not zip/text/image/video', () => {
    for (const k of ['webm', 'm4a', 'ogg', 'mp3', 'wav', 'flac', 'amr', 'aac'] as const) {
      expect(looksLikeAudio(F[k]), `${k} should be flagged as audio by the importer`).toBe(true);
    }
    for (const k of ['mp4generic', 'heic', 'png', 'jpeg', 'zip', 'text'] as const) {
      expect(looksLikeAudio(F[k]), `${k} must NOT be flagged as audio (chat zips/text/images/video pass through)`).toBe(false);
    }
  });

  it('is immune to a renamed extension / spoofed content-type — it reads bytes only', () => {
    // opus bytes are opus bytes regardless of what they are called or labelled.
    expect(isAppRecordingContainer(F.ogg)).toBe(false); // an .opus renamed .webm still fails the voice sniff
    expect(isAllowedImage(F.ogg)).toBe(false); // opus bytes sent as content-type image/png still fail the image allow-list
    expect(looksLikeAudio(F.webm)).toBe(true); // webm bytes renamed .txt are still caught by the importer
  });

  it('isWebm matches only the EBML magic', () => {
    expect(isWebm(F.webm)).toBe(true);
    expect(isWebm(F.m4a)).toBe(false);
  });
});
