import { ModelError } from '../../ports/model.js';
import type { CardScanner, CardScanResult } from '../../ports/card-scanner.js';
import { CARD_SCAN_SYSTEM_PROMPT, parseCardScan } from './card-scan-prompt.js';

/** The image → model-text seam. Injected so the scanner is testable without a
 *  network call, and so Anthropic-local vs. Bedrock-prod is a wiring swap. */
export interface VisionCompletion {
  complete(imageBase64: string, mediaType: string): Promise<string>;
}

/** Sniff the media type from magic bytes; default to JPEG. */
export function detectMediaType(image: Uint8Array): string {
  if (image[0] === 0x89 && image[1] === 0x50) return 'image/png'; // PNG
  if (image[0] === 0x47 && image[1] === 0x49) return 'image/gif'; // GIF
  if (image[0] === 0x52 && image[1] === 0x49 && image[8] === 0x57) return 'image/webp'; // RIFF….WEBP
  return 'image/jpeg';
}

/**
 * Real business-card scanner (P4-5): a vision model behind the CardScanner port.
 * Delivery (Anthropic locally, Bedrock in prod) is injected; the trust rules
 * live in {@link parseCardScan} — unreadable fields stay null, a non-card is
 * reported as such, and a model that returns garbage yields a non-card rather
 * than a fabricated contact.
 */
export class AnthropicCardScanner implements CardScanner {
  constructor(private readonly vision: VisionCompletion) {}

  async scan(image: Uint8Array): Promise<CardScanResult> {
    const base64 = Buffer.from(image).toString('base64');
    let text: string;
    try {
      text = await this.vision.complete(base64, detectMediaType(image));
    } catch {
      // A failed scan is not a card — never a guessed contact.
      return { isCard: false, contact: null };
    }
    return parseCardScan(text);
  }
}

export interface AnthropicVisionOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}

interface AnthropicResponseBody {
  content?: Array<{ type: string; text?: string }>;
}

/**
 * HTTP transport for the Anthropic Messages API vision call (the shape Bedrock
 * speaks too). Sends one image block + the card-scan instruction and returns the
 * model's text. Failures become a typed {@link ModelError}.
 */
export class AnthropicVisionClient implements VisionCompletion {
  constructor(private readonly opts: AnthropicVisionOptions) {}

  async complete(imageBase64: string, mediaType: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 30_000);
    let response: Response;
    try {
      response = await fetch(`${this.opts.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.opts.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.opts.model,
          max_tokens: 512,
          system: CARD_SCAN_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
                { type: 'text', text: 'Read this business card.' },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
    } catch (cause) {
      throw new ModelError('vision request failed', cause);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new ModelError(`vision request failed: HTTP ${response.status}`);
    const body = (await response.json()) as AnthropicResponseBody;
    return (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  }
}
