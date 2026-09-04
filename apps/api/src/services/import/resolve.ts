import { parseWhatsAppExport } from './whatsapp.js';
import { isZip, unzipTextEntries, DEFAULT_ZIP_CAPS, type ZipCaps } from './zip.js';

/**
 * [IMPORT-ZIP] Turn raw uploaded bytes into the WhatsApp transcript text to import.
 *
 * A `.zip` (what iOS actually exports) is unpacked and the transcript is chosen by CONTENT —
 * whichever entry parses as a WhatsApp export, the largest if several — never by filename, which
 * varies by platform and locale (`_chat.txt`, `WhatsApp Chat with X.txt`, localised names). A bare
 * buffer is treated as UTF-8 text (the existing `.txt` / paste path, unchanged). If nothing in a
 * zip parses, reject with a message naming what was found.
 */
export type ResolveResult = { ok: true; text: string } | { ok: false; reason: string };

function safeParse(text: string): ReturnType<typeof parseWhatsAppExport> {
  try {
    return parseWhatsAppExport(text);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
}

export function resolveTranscript(buf: Buffer, caps: ZipCaps = DEFAULT_ZIP_CAPS): ResolveResult {
  if (!isZip(buf)) return { ok: true, text: buf.toString('utf8') };

  const un = unzipTextEntries(buf, caps);
  if (!un.ok) return un;

  // Keep the entries whose text parses as a WhatsApp transcript (content, not filename).
  const parseable = un.entries.filter((e) => {
    const r = safeParse(e.text);
    return r.ok && r.messages.length > 0;
  });

  if (parseable.length === 0) {
    const names = un.entries.map((e) => e.name).filter(Boolean);
    const seen = names.length ? `Text files seen: ${names.join(', ')}.` : 'No text files were found inside it.';
    return { ok: false, reason: `No WhatsApp transcript was found in the zip. ${seen} Use WhatsApp's Export Chat.` };
  }

  // Several parse → the largest is the real transcript (media captions / readmes are short).
  parseable.sort((a, b) => b.text.length - a.text.length);
  return { ok: true, text: parseable[0]!.text };
}
