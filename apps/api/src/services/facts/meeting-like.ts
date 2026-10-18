/**
 * [P21-R3] A "promise" row that is really a MEETING — the extractor sometimes stores a confirmed viewing
 * ("Confirmed viewing on 25/04/2026 at 11am") as a rep promise as well as (or instead of) a meeting, and it
 * then shows under "You promised". Deterministic and deliberately tight: only an arranged event stated as
 * done ("Confirmed/Scheduled/Booked a viewing|meeting|visit|call|appointment…") or a bare event at a time
 * ("Viewing on 25/04…", "Site visit at 10am…"). A commitment that merely mentions one ("Send the meeting
 * notes", "Arrange a viewing for Sara", "call back about…") is still a promise.
 */
const ARRANGED = /^(?:confirmed|scheduled|booked|arranged|fixed|set up)\s+(?:(?:a|an|the)\s+)?(?:viewing|meeting|site visit|visit|appointment|call|showing)\b/i;
const BARE_EVENT = /^(?:viewing|site visit|appointment|showing)\s+(?:on|at|for)\b/i;

export function isMeetingNotPromise(text: string): boolean {
  const t = text.trim();
  return ARRANGED.test(t) || BARE_EVENT.test(t);
}
