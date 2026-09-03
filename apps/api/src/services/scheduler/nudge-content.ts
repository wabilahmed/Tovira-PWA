/**
 * [NUDGE-CONTENT] What the pre-meeting nudge says. A notification reading "you have a
 * meeting with Meridian" is worthless — the rep knows. The value is the single most
 * actionable item from the brief, in a fixed priority: an open promise (the rep owes
 * something) → an unanswered question → a cooling signal. If nothing is substantive the
 * nudge still fires with the meeting details and invents nothing — an honest thin nudge.
 *
 * Brand: measured, no exclamation marks, no emoji. Our framing is fixed copy; the quoted
 * promise/question is the rep's own words (a receipt), shown verbatim but length-clipped.
 */

import { zonedTodayIso } from '../time/zone.js';

/** Format a meeting instant on the rep's clock: "today at 3:00 PM", "tomorrow at 9:30 AM",
 *  or "9 Jul at 3:00 PM". The time is always the rep's local wall-clock. */
export function formatMeetingWhen(instantMs: number, tz: string, nowMs: number): string {
  const instant = new Date(instantMs);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(instant);
  const dayIso = zonedTodayIso(tz, instant);
  const todayIso = zonedTodayIso(tz, new Date(nowMs));
  const tomorrowIso = zonedTodayIso(tz, new Date(nowMs + 24 * 60 * 60 * 1000));
  const dayLabel =
    dayIso === todayIso ? 'today'
    : dayIso === tomorrowIso ? 'tomorrow'
    : new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' }).format(instant);
  return `${dayLabel} at ${time}`;
}

export interface NudgeSignals {
  clientName: string;
  clientId: string;
  /** Meeting time already formatted in the rep's timezone, e.g. "today at 3:00 PM". */
  whenLabel: string;
  /** Most actionable rep-owed open promise (text), if any. */
  topPromise?: string;
  /** Most pressing unanswered client question (text), if any. */
  topQuestion?: string;
  /** Days of silence, only when the client is past the cooling threshold (else 0/undefined). */
  silentDays?: number;
}

export interface NudgeContent {
  clientId: string;
  title: string;
  body: string;
  /** Deep link so a tap opens THIS client's brief (where the receipt lives), not home. */
  url: string;
}

const CLIP = 120;
function clip(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > CLIP ? `${t.slice(0, CLIP)}…` : t;
}

/** The one line, in priority order, or null when nothing is substantive. */
function topItem(s: NudgeSignals): string | null {
  if (s.topPromise?.trim()) return `Open promise — ${clip(s.topPromise)}`;
  if (s.topQuestion?.trim()) return `Unanswered — ${clip(s.topQuestion)}`;
  if (s.silentDays && s.silentDays > 0) return `Going quiet — silent ${s.silentDays} days`;
  return null;
}

export function composeNudgeContent(s: NudgeSignals): NudgeContent {
  const item = topItem(s);
  return {
    clientId: s.clientId,
    title: s.clientName,
    body: item ? `${s.whenLabel} · ${item}` : s.whenLabel,
    url: `/app?client=${encodeURIComponent(s.clientId)}`,
  };
}
