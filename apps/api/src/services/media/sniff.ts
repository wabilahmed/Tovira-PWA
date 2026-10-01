/**
 * [VOICE-GATE] Magic-byte sniffing for the audio-ingress lockdown. We classify by the ACTUAL leading
 * bytes of the file, never the content-type header and never the filename/extension — an .opus renamed
 * .txt (or sent with content-type image/png) must not get through. Only the first ~12 bytes are read.
 *
 * Containers:
 *   WebM / Matroska  EBML magic  1A 45 DF A3            at offset 0
 *   ISO-BMFF (MP4/MOV/m4a/HEIC)  'ftyp' box             at offset 4; the brand is at offset 8..11
 *   Ogg (Opus — WhatsApp voice)  'OggS'                 at offset 0
 *   MP3                          'ID3' or frame-sync FF Ex/Fx
 *   WAV                          'RIFF' .... 'WAVE'
 *   WebP (image)                 'RIFF' .... 'WEBP'
 *   FLAC 'fLaC' · AMR '#!AMR' · AAC/ADTS FF F1/F9
 *   PNG 89 50 4E 47 · JPEG FF D8 FF
 */

type Bytes = Uint8Array;

const at = (b: Bytes, off: number, ...sig: number[]): boolean => sig.every((v, i) => b[off + i] === v);
const ascii = (b: Bytes, off: number, s: string): boolean => [...s].every((c, i) => b[off + i] === c.charCodeAt(0));

export const isWebm = (b: Bytes): boolean => at(b, 0, 0x1a, 0x45, 0xdf, 0xa3);
const hasFtyp = (b: Bytes): boolean => ascii(b, 4, 'ftyp');
/** The ISO-BMFF major brand (offset 8..11), e.g. "M4A ", "mp42", "isom", "qt  ", "heic". */
const ftypBrand = (b: Bytes): string => (hasFtyp(b) ? String.fromCharCode(b[8] ?? 0, b[9] ?? 0, b[10] ?? 0, b[11] ?? 0) : '');

export const isOgg = (b: Bytes): boolean => ascii(b, 0, 'OggS');
const isMp3 = (b: Bytes): boolean => ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1] ?? 0) >= 0xe0);
const isWav = (b: Bytes): boolean => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE');
const isFlac = (b: Bytes): boolean => ascii(b, 0, 'fLaC');
const isAmr = (b: Bytes): boolean => ascii(b, 0, '#!AMR');
const isAac = (b: Bytes): boolean => b[0] === 0xff && ((b[1] ?? 0) === 0xf1 || (b[1] ?? 0) === 0xf9);

const isPng = (b: Bytes): boolean => at(b, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const isJpeg = (b: Bytes): boolean => at(b, 0, 0xff, 0xd8, 0xff);
const isWebpImage = (b: Bytes): boolean => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP');
/** HEIF/HEIC (iPhone photos): an ftyp box whose brand is in the HEIF family — NOT a generic audio/video brand. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif']);
const isHeif = (b: Bytes): boolean => hasFtyp(b) && HEIF_BRANDS.has(ftypBrand(b).trim());

/** ISO-BMFF brands that denote AUDIO (iPhone voice memo / m4a). "mp42"/"isom" are generic/video and
 *  excluded here so the import audio-reject never fires on a video or on a chat zip. */
const AUDIO_FTYP_BRANDS = new Set(['M4A', 'M4B', 'M4P', 'aac']);

/** [IMAGES-GATE] The allow-list: the route accepts ONLY these. Everything else (audio, video, zip, pdf,
 *  svg, renamed bytes) is rejected. */
export const isAllowedImage = (b: Bytes): boolean => isPng(b) || isJpeg(b) || isWebpImage(b) || isHeif(b);

/** [VOICE-GATE] The containers the app's OWN MediaRecorder produces across browsers: WebM/Matroska
 *  (Chrome/Firefox/Android) and ISO-BMFF/MP4 (Safari/iOS). Any ftyp is accepted because Safari's exact
 *  brand varies and we must not reject a legitimate iPhone recording; see the wrap for the m4a trade-off. */
export const isAppRecordingContainer = (b: Bytes): boolean => isWebm(b) || hasFtyp(b);

/** [IMPORT-GATE] Does this look like an AUDIO file (so the chat importer can refuse it)? A chat payload
 *  is only ever a zip ('PK') or UTF-8 text, so none of these ever match a legitimate import. */
export const looksLikeAudio = (b: Bytes): boolean =>
  isWebm(b) || isOgg(b) || isMp3(b) || isWav(b) || isFlac(b) || isAmr(b) || isAac(b) || (hasFtyp(b) && AUDIO_FTYP_BRANDS.has(ftypBrand(b).trim()));

/** The one-line refusal shown wherever audio from another source is blocked (BETA Task 3). */
export const AUDIO_ELSEWHERE_MESSAGE = "Tovira records voice notes inside the app; audio files from other apps can't be added.";
/** The refusal for an in-app recording that exceeds the length cap (BETA Task 3). */
export const VOICE_TOO_LONG_MESSAGE = 'This recording is over the 10-minute limit for a voice note.';
/** The refusal for a non-image at the image upload route. */
export const NOT_AN_IMAGE_MESSAGE = 'That file is not a supported image (PNG, JPEG, WebP, or HEIC).';
