import { describe, it, expect, vi } from 'vitest';
import { parseCardScan } from './card-scan-prompt.js';
import { AnthropicCardScanner, detectMediaType, type VisionCompletion } from './anthropic-card-scanner.js';

const visionReturning = (text: string): VisionCompletion => ({ complete: vi.fn().mockResolvedValue(text) });
const image = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic

describe('[P4-5] parseCardScan — trust rules', () => {
  it('parses a clear card into a verbatim contact', () => {
    const r = parseCardScan('{"is_card":true,"name":"Jane Doe","title":"CTO","phone":"+971 50 123 4567","email":"jane@acme.ae"}');
    expect(r.isCard).toBe(true);
    expect(r.contact).toEqual({ name: 'Jane Doe', title: 'CTO', phone: '+971 50 123 4567', email: 'jane@acme.ae' });
  });

  // NEGATIVE: a blurry/absent field stays null — never guessed or pattern-completed.
  it('leaves unreadable fields null rather than guessing', () => {
    const r = parseCardScan('{"is_card":true,"name":"Sam Rahman","title":null,"phone":"","email":"   "}');
    expect(r.contact).toEqual({ name: 'Sam Rahman', title: null, phone: null, email: null });
  });

  // NEGATIVE: a non-card image is reported, not turned into an invented contact.
  it('reports a non-card image as such', () => {
    const r = parseCardScan('{"is_card":false,"name":null,"title":null,"phone":null,"email":null}');
    expect(r).toEqual({ isCard: false, contact: null });
  });

  // NEGATIVE: is_card must be strictly true — a name alone never forces a card.
  it('treats a missing/false is_card as a non-card even if a name is present', () => {
    expect(parseCardScan('{"name":"Jane"}')).toEqual({ isCard: false, contact: null });
    expect(parseCardScan('{"is_card":"yes","name":"Jane"}')).toEqual({ isCard: false, contact: null });
  });

  // NEGATIVE: garbage / non-JSON from the model yields a non-card, not a crash or a guess.
  it('returns a non-card for unparseable model output', () => {
    expect(parseCardScan('I could not read this image.')).toEqual({ isCard: false, contact: null });
    expect(parseCardScan('')).toEqual({ isCard: false, contact: null });
  });

  it('tolerates prose around the JSON object', () => {
    const r = parseCardScan('Here is the card:\n{"is_card":true,"name":"Lee","title":null,"phone":null,"email":null}\nThanks');
    expect(r.isCard).toBe(true);
    expect(r.contact?.name).toBe('Lee');
  });
});

describe('[P4-5] AnthropicCardScanner', () => {
  it('scans an image through the vision seam into a contact proposal', async () => {
    const vision = visionReturning('{"is_card":true,"name":"Omar","title":"Owner","phone":null,"email":"omar@x.ae"}');
    const scanner = new AnthropicCardScanner(vision);
    const r = await scanner.scan(image);
    expect(r.isCard).toBe(true);
    expect(r.contact).toEqual({ name: 'Omar', title: 'Owner', phone: null, email: 'omar@x.ae' });
    expect(vision.complete).toHaveBeenCalledTimes(1);
    // the image is passed base64-encoded with a sniffed media type
    const [, mediaType] = (vision.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(mediaType).toBe('image/jpeg');
  });

  // NEGATIVE: a failed vision call is a non-card, never a fabricated contact.
  it('returns a non-card when the vision call fails', async () => {
    const scanner = new AnthropicCardScanner({ complete: vi.fn().mockRejectedValue(new Error('timeout')) });
    expect(await scanner.scan(image)).toEqual({ isCard: false, contact: null });
  });
});

describe('detectMediaType', () => {
  it('sniffs PNG, JPEG, and defaults to JPEG', () => {
    expect(detectMediaType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(detectMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectMediaType(new Uint8Array([0x00, 0x01]))).toBe('image/jpeg');
  });
});
