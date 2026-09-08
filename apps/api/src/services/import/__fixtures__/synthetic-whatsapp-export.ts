/**
 * [PARSE-REAL] A deterministic, synthetic WhatsApp export shaped EXACTLY like the real
 * 5,940-message sample (WhatsApp_Chat_with_Bilal_Pak.txt) — same dash/Android format, two speakers,
 * 516 <Media omitted> markers, 2 system notices, 276 continuation (multi-line) lines, and a
 * 2019→2026 date span — but with entirely INVENTED content. The real file is personal and is never
 * committed; this generator is (like the bake-off ladder). The counterpart is a nickname
 * ("Bubu DXB") on purpose, so the same fixture serves the alias story.
 */
export interface SyntheticExport {
  text: string;
  expected: {
    messages: number;
    bySender: Record<string, number>;
    media: number;
    system: number;
    continuations: number;
    firstYear: string;
    lastYear: string;
  };
}

const REP = 'Wabil';
const COUNTERPART = 'Bubu DXB';
const TOTAL = 5940;
const REP_COUNT = 3010;
const MEDIA = 516;
const CONTINUATIONS = 276;

const DAY_MS = 86_400_000;
const pad = (n: number): string => String(n).padStart(2, '0');

/** Spread `count` indices evenly across [0, TOTAL). */
function spread(count: number): Set<number> {
  const s = new Set<number>();
  for (let k = 0; k < count; k++) s.add(Math.floor((k * TOTAL) / count));
  return s;
}

export function syntheticWhatsAppExport(): SyntheticExport {
  const base = Date.UTC(2019, 6, 13); // 13 Jul 2019
  const spanDays = 2606; // lands the final message in Sep 2026
  const mediaAt = spread(MEDIA);
  // Continuation lines must not land on a media message (keeps both counts independent + clean).
  const contAt = new Set<number>();
  for (let k = 0, i = 0; k < CONTINUATIONS && i < TOTAL; i++) {
    if (!mediaAt.has(i) && i > 0) { contAt.add(i); k++; }
  }

  const lines: string[] = [];
  const fmt = (i: number, extraDays = 0): string => {
    const d = new Date(base + (Math.floor((i * spanDays) / (TOTAL - 1)) + extraDays) * DAY_MS);
    const hour12 = ((i % 11) + 1);
    const ampm = i % 2 === 0 ? 'am' : 'pm';
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}, ${hour12}:${pad(i % 60)} ${ampm}`;
  };

  // System notice #1 — the end-to-end-encryption line (no "Sender:").
  lines.push(`${fmt(0)} - Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them.`);

  let w = 0;
  let b = 0;
  const bySender: Record<string, number> = { [REP]: 0, [COUNTERPART]: 0 };
  for (let i = 0; i < TOTAL; i++) {
    const sender = w < REP_COUNT && (b >= TOTAL - REP_COUNT || i % 2 === 0) ? REP : COUNTERPART;
    if (sender === REP) w++; else b++;
    bySender[sender]!++;

    let body: string;
    if (mediaAt.has(i)) body = '<Media omitted>';
    else if (i === 12) body = 'Re: the villa — still keen, will confirm the deposit next Thursday'; // colon-in-body
    else body = `msg ${i} about the deal`;
    lines.push(`${fmt(i)} - ${sender}: ${body}`);

    // A continuation line: a second body line with NO timestamp prefix (must join to this message).
    if (contAt.has(i)) lines.push(`and one more thing on ${i}`);

    // System notice #2 — mid-file, so it exercises "not folded into the previous message".
    if (i === 3000) lines.push(`${fmt(i)} - You changed the group description`);
  }

  const firstYear = String(new Date(base).getUTCFullYear());
  const lastYear = String(new Date(base + spanDays * DAY_MS).getUTCFullYear());
  return {
    text: lines.join('\n'),
    expected: { messages: TOTAL, bySender, media: MEDIA, system: 2, continuations: CONTINUATIONS, firstYear, lastYear },
  };
}
