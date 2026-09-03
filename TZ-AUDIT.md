# TZ-AUDIT — every date / day / week / expiry computation, classified (Task B1)

`test(TZ-AUDIT)`. Before changing anything, the full list of where a date, day boundary, day count,
week boundary, or time-based expiry is computed, each marked **rep-timezone-aware**, **UTC — needs
fixing** (a rep's *day* or *week* matters), or **UTC — legitimately fine** (a pure *duration* /
instant comparison, no calendar edge). The distinction that decides each: **DURATION** (elapsed ms —
UTC is correct) vs **CALENDAR BOUNDARY** (which day/week is it *for this rep* — needs their zone).

Per-rep tz is `users.timezone` (migration 0042); helpers in `services/time/zone.ts`
(`zonedTodayIso`, `zonedWallClockToInstant`, `normalizeTimeZone`, default `Asia/Dubai`).

## Two findings that change the batch's premise
1. **Going-cold is NOT a timezone bug.** The batch listed it as one of the three fixes, but every
   going-cold site is `nowMs − lastTouchedAt` elapsed ms — a **duration**, identical on any server
   clock. "Silent 21 days" is not computed on the wrong clock; it is 21 elapsed 24h periods. (Whether
   "days" should mean *calendar days crossed* vs *elapsed 24h* is a separate product question, not a
   tz bug.) **No fix needed** — recorded here so we skip it deliberately.
2. **The real day-boundary set is larger than the three named.** Beyond Monday + priorities, the sweep
   found overdue-promise "before today", key-date/birthday reminders, the fresh-capture extraction
   reference "today", the push silence-budget day, and the verify-resend daily limit — all genuine
   per-rep day boundaries computed on UTC. See the middle table.

## REP-TZ-AWARE (already correct — the A3 reference)
| Item | Location |
|---|---|
| Meeting parse/resolve "today" + wall-clock→instant | `meetings-routes.ts:23,60,86,112` |
| Meeting datetime resolve (extraction) | `extraction-service.ts:97` |
| Pre-meeting nudge today/tomorrow labels | `nudge-content.ts:19-21`, `nudge-signals.ts:34` |

## UTC — NEEDS FIXING (a rep's DAY / WEEK matters)
| Item | Location | Boundary | In this batch? |
|---|---|---|---|
| Monday week boundary `mondayOf` | `monday-service.ts:30-34` | week | **B2/B3 (core)** |
| Monday due-this-week / upcoming window | `monday-service.ts:48-49,52,58` | day | **B2/B3 (core)** |
| Priorities daily cache key `dayOf` | `priorities-service.ts:31-33,52,61,77` | day | **B2/B3 (core)** |
| Priorities "refreshes left today" reset | `priorities-service.ts:87` | day | **B2/B3 (core)** |
| Date reminders / key-dates window | `scan-service.ts:29-55`; `book-scan-service.ts:148-149`; `monday-service.ts:57-59` | day | found — decide |
| Overdue promise "before today" | `scan-service.ts:77,82`; `hero-service.ts:78,91,154-162` | day | found — decide |
| Promise-kept-on-time | `facts-routes.ts:84-85` | day | found — decide |
| Extraction reference "today" (fresh capture only; imports use message date) | `notes-routes.ts:32,304`; `recall-service.ts:129`; `index.ts:191` | day | found — decide |
| Push silence-budget day key | `push-dispatch-service.ts:46-47` | day | found — decide |
| Verify-resend daily limit (low stakes) | `auth-service.ts:259-261` | day | found — decide |

## UTC — LEGITIMATELY FINE (pure duration / instant — deliberately not changed)
| Item | Location | Why fine |
|---|---|---|
| **Going-cold thresholds (all sites)** | `scan-service.ts:129`; `hero-service.ts:89`; `nudge-signals.ts:57`; `book-scan-service.ts:108`; `monday-service.ts:55`; `proactive-routes.ts:47` | elapsed since `lastTouchedAt` — a duration |
| Chat-refresh staleness | `scan-service.ts:171` | elapsed since last import |
| Trial start/end, +7, +30, days-left | `billing-service.ts:84,96,111,128,137`; `trial-email-service.ts:35-38`; `Billing.tsx:54` | durations added to an instant; countdowns |
| Recall session 30-min idle | `pg-recall-session-repository.ts:14`; `in-memory-…:17` | 30-min duration |
| Pending-note 14-day TTL | `ask-capture-service.ts:105` | elapsed-since-capture duration |
| Scan nudge window | `scan-service.ts:105-107` | duration on absolute meeting instants |
| UI `daysSince` + positional YYYY-MM-DD formatting | `format/dates.ts:25-26,54-56`; `MondayDigest.tsx`, `BookScan.tsx`, `Alerts.tsx` | date strings render positionally (no drift); "N days" are durations |
| Corpus month span | `corpus-service.ts:16-20` | coarse span between two instants |
| Account-email date stamp | `account-email-service.ts:6-9` | deliberate stable UTC in email |

## Cross-cutting note for the fix (B3)
Every "needs fixing" item receives a **server-global `Date.now()`** from an HTTP route or the shared
nightly job. On-request surfaces (overdue/promise-kept/reminders/priorities cache read) can resolve
`auth.timezoneFor(userId)` at the request. But the **nightly jobs** (`priorities-nightly`, the Monday
digest push) run **one UTC boundary for the whole user base** — so the rep's local day/week must be
resolved *inside the per-user loop*, and idempotency recorded **per rep-day**, not per global tick
(B3). That is the real architectural change.
