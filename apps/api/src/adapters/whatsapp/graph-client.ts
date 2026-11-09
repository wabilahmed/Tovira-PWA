import { MediaTooLargeError, type WhatsAppGraph } from '../../ports/whatsapp.js';

/**
 * [P67] The WhatsApp Cloud API over HTTPS. The access token is sent only as a Bearer header to graph.facebook.com and
 * the media host, and is never logged; errors carry the HTTP status only (never a URL, a body or file content).
 */
export class CloudApiGraph implements WhatsAppGraph {
  constructor(private readonly opts: { accessToken: string; phoneNumberId: string; graphVersion?: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {}

  private get base(): string { return `https://graph.facebook.com/${this.opts.graphVersion ?? 'v27.0'}`; }
  private get f(): typeof fetch { return this.opts.fetchImpl ?? fetch; }
  private signal(): AbortSignal { return AbortSignal.timeout(this.opts.timeoutMs ?? 30_000); }
  private auth(): Record<string, string> { return { authorization: `Bearer ${this.opts.accessToken}` }; }

  async mediaUrl(mediaId: string): Promise<{ url: string; fileSize: number | null; mimeType: string | null }> {
    const res = await this.f(`${this.base}/${encodeURIComponent(mediaId)}`, { headers: this.auth(), signal: this.signal() });
    if (!res.ok) throw new Error(`whatsapp media lookup failed (${res.status})`);
    const b = (await res.json()) as { url?: string; file_size?: number; mime_type?: string };
    if (!b.url) throw new Error('whatsapp media lookup returned no url');
    return { url: b.url, fileSize: typeof b.file_size === 'number' ? b.file_size : null, mimeType: b.mime_type ?? null };
  }

  async download(url: string, maxBytes: number): Promise<Uint8Array> {
    const res = await this.f(url, { headers: this.auth(), signal: this.signal() });
    if (!res.ok || !res.body) throw new Error(`whatsapp media download failed (${res.status})`);
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > maxBytes) throw new MediaTooLargeError();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new MediaTooLargeError(); }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.byteLength; }
    return out;
  }

  async sendText(to: { phone?: string | null; waUserId?: string | null }, body: string): Promise<void> {
    const target = to.phone ? { to: to.phone.replace(/\D/g, '') } : { recipient: to.waUserId };
    const res = await this.f(`${this.base}/${encodeURIComponent(this.opts.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { ...this.auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...target, type: 'text', text: { body, preview_url: false } }),
      signal: this.signal(),
    });
    if (!res.ok) throw new Error(`whatsapp send failed (${res.status})`);
  }
}
