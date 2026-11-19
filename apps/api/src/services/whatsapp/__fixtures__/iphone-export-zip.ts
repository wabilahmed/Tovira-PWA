import { deflateRawSync, crc32 } from 'node:zlib';

/**
 * [P79] An iPhone WhatsApp export, built in code (nothing personal, no binary file committed), shaped like the real
 * thing: "WhatsApp Chat - <name>.zip" with `_chat.txt` DEFLATE-compressed and written with a data descriptor (general
 * purpose flag bit 3, sizes zero in the local header, as iOS writes it), the iOS line format ("[19/11/2026, 5:30:12 PM]"
 * with U+202F before PM and U+200E before attachment markers), and, with media, the files iOS puts next to it:
 * a photo, a 6 MB video (bigger than the in-app reader's 5 MB per-file cap), a .docx (itself a zip), a voice note,
 * a PDF and a contact card (.vcf, which is text).
 */
export const IPHONE_CHAT = [
  '[18/11/2026, 4:02:10 PM] Wabil: ‎Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them.',
  '[18/11/2026, 4:05:41 PM] Anjali Mehra: Hi! Did the revised quote come through?',
  '[18/11/2026, 4:07:03 PM] Wabil: Sending it today, and the floor plan by Friday.',
  '‎[18/11/2026, 4:09:20 PM] Anjali Mehra: ‎<attached: 00000004-PHOTO-2026-11-18-16-09-20.jpg>',
  '[18/11/2026, 4:10:02 PM] Anjali Mehra: My husband wants to see it too.',
  'He is back on Sunday.',
  '‎[18/11/2026, 4:12:45 PM] Anjali Mehra: ‎<attached: 00000006-VIDEO-2026-11-18-16-12-45.mp4>',
  '‎[18/11/2026, 4:13:10 PM] Wabil: ‎<attached: 00000007-Proposal.docx>',
  '‎[18/11/2026, 4:15:00 PM] Anjali Mehra: ‎<attached: 00000008-AUDIO-2026-11-18-16-15-00.opus>',
].join('\r\n');

const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

interface Entry { name: string; data: Buffer; deflate: boolean; descriptor?: boolean }

/** A standard zip writer (local headers, optional data descriptors, central directory, end record). */
export function buildZip(entries: Entry[]): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const body = e.deflate ? deflateRawSync(e.data) : e.data;
    const crc = crc32(e.data);
    const flag = 0x0800 | (e.descriptor ? 0x0008 : 0); // UTF-8 names (+ data descriptor)
    const method = e.deflate ? 8 : 0;
    const lfh = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flag), u16(method), u16(0), u16(0),
      u32(e.descriptor ? 0 : crc), u32(e.descriptor ? 0 : body.length), u32(e.descriptor ? 0 : e.data.length),
      u16(name.length), u16(0), name, body,
      e.descriptor ? Buffer.concat([u32(0x08074b50), u32(crc), u32(body.length), u32(e.data.length)]) : Buffer.alloc(0),
    ]);
    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(0x031e), u16(20), u16(flag), u16(method), u16(0), u16(0),
      u32(crc), u32(body.length), u32(e.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    locals.push(lfh); offset += lfh.length;
  }
  const cd = Buffer.concat(centrals);
  return Buffer.concat([...locals, cd, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(offset), u16(0)]);
}

/** Pseudo-random bytes (deterministic), so "media" doesn't compress and has NULs like real media. */
function noise(n: number, seed: number): Buffer {
  const b = Buffer.alloc(n); let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; }
  return b;
}

const chatEntry = (text = IPHONE_CHAT): Entry => ({ name: '_chat.txt', data: Buffer.from(text, 'utf8'), deflate: true, descriptor: true });

/** "Without media": the zip holds only `_chat.txt`. */
export const iphoneZipWithoutMedia = (text?: string): Uint8Array => new Uint8Array(buildZip([chatEntry(text)]));

/** "Attach media": `_chat.txt` plus the media files, about 6.3 MB in all (under the 10 MB limit). */
export function iphoneZipWithMedia(): Uint8Array {
  const docx = buildZip([{ name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types/>'), deflate: true }, { name: 'word/document.xml', data: Buffer.from('<w:document/>'), deflate: true }]);
  return new Uint8Array(buildZip([
    chatEntry(),
    { name: '00000004-PHOTO-2026-11-18-16-09-20.jpg', data: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), noise(180_000, 1)]), deflate: false, descriptor: true },
    { name: '00000006-VIDEO-2026-11-18-16-12-45.mp4', data: Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), noise(6_000_000, 2)]), deflate: false, descriptor: true },
    { name: '00000007-Proposal.docx', data: docx, deflate: false, descriptor: true },
    { name: '00000008-AUDIO-2026-11-18-16-15-00.opus', data: Buffer.concat([Buffer.from('OggS\u0000', 'latin1'), noise(40_000, 3)]), deflate: false, descriptor: true },
    { name: '00000009-Brochure.pdf', data: Buffer.concat([Buffer.from('%PDF-1.7\n'), noise(90_000, 4)]), deflate: true, descriptor: true },
    { name: '00000010-Anjali Mehra.vcf', data: Buffer.from('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Anjali Mehra\r\nEND:VCARD\r\n'), deflate: true, descriptor: true },
  ]));
}
