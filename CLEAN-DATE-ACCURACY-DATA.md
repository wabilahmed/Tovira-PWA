# Clean-input date/time accuracy — DATA (machine record)

Run 2026-09-19T09:53:22.703Z · prompt `tovira-extract-v0.9.5` UNCHANGED · model `claude-sonnet-5` · 20 runs/input · N=500.
Anchor = referenceDateFor (latest message date), exactly as production. Nothing changed.

**Total spend: $7.3298 (AED 26.92)** across 500 calls + 2 warm-up.

## Overall

- **Correct (right date, right time, right bucket): 490/500 = 98.0%**
- **Error rate: 10/500 = 2.0%** · 95% Wilson CI on accuracy [96.4%, 98.9%]
- **By verdict:** correct=490 · silent-miss=7 · wrong-time=3
- **Anchor errors: 0** (resolved to the decoy message's date) · **resolution/other wrong-date: 0**
- **Silent misses: 7** · **misclassification (right date, wrong bucket): 0** · **fabricated time on date-only: 0**

## By class

| Class | correct/N | error% |
|---|---|---|
| A | 79/80 | 1.3% |
| B | 80/80 | 0.0% |
| C | 60/60 | 0.0% |
| D | 80/80 | 0.0% |
| E | 60/60 | 0.0% |
| F | 60/60 | 0.0% |
| G | 71/80 | 11.3% |

## By input (correct/20 and every distinct wrong answer with frequency)


**A1** (A · weekday+time) — exp `2026-09-17T15:00` in meeting · ref(today)=2026-09-14 · **20/20 correct**
- phrase: `Thursday 3pm` · confirmed values seen: true
- wrong answers: (none)

**A2** (A · weekday+time) — exp `2026-09-20T10:00` in meeting · ref(today)=2026-09-15 · **20/20 correct**
- phrase: `Sunday 10am` · confirmed values seen: true
- wrong answers: (none)

**A3** (A · weekday+time) — exp `2026-09-21T09:00` in meeting · ref(today)=2026-09-16 · **20/20 correct**
- phrase: `Monday 9am` · confirmed values seen: true/false
- wrong answers: (none)

**A4** (A · weekday+time) — exp `2026-09-18T17:00` in meeting · ref(today)=2026-09-14 · **19/20 correct**
- phrase: `Friday 5pm` · confirmed values seen: true/false
- wrong answers: silent-miss ×1

**B1** (B · date+time) — exp `2027-01-22T11:00` in meeting · ref(today)=2026-09-14 · **20/20 correct**
- phrase: `22 January 2027 at 11am` · confirmed values seen: false
- wrong answers: (none)

**B2** (B · date+time) — exp `2026-12-03T14:30` in meeting · ref(today)=2026-09-15 · **20/20 correct**
- phrase: `3 December 2026 at 2:30pm` · confirmed values seen: false/true
- wrong answers: (none)

**B3** (B · date+time) — exp `2027-08-18T09:00` in meeting · ref(today)=2026-09-16 · **20/20 correct**
- phrase: `18 August 2027, 9am` · confirmed values seen: true
- wrong answers: (none)

**B4** (B · date+time) — exp `2027-04-07T16:00` in meeting · ref(today)=2026-09-14 · **20/20 correct**
- phrase: `7 April 2027 at 4pm` · confirmed values seen: false/true
- wrong answers: (none)

**C1** (C · date, no time) — exp `2027-03-03 (date only)` in key_date · ref(today)=2026-09-14 · **20/20 correct**
- phrase: `handover on 3 March 2027` · confirmed values seen: undefined
- wrong answers: (none)

**C2** (C · date, no time) — exp `2026-11-30 (date only)` in key_date · ref(today)=2026-09-15 · **20/20 correct**
- phrase: `possession 30 November 2026` · confirmed values seen: undefined
- wrong answers: (none)

**C3** (C · date, no time) — exp `2027-07-01 (date only)` in key_date · ref(today)=2026-09-16 · **20/20 correct**
- phrase: `policy renews 1 July 2027` · confirmed values seen: undefined
- wrong answers: (none)

**D1** (D · relative) — exp `2026-09-15T16:00` in meeting · ref(today)=2026-09-14 · **20/20 correct**
- phrase: `tomorrow at 4` · confirmed values seen: true
- wrong answers: (none)

**D2** (D · relative) — exp `2026-09-17T10:00` in meeting · ref(today)=2026-09-15 · **20/20 correct**
- phrase: `day after tomorrow at 10am` · confirmed values seen: false/true
- wrong answers: (none)

**D3** (D · relative) — exp `2026-09-17T09:00` in meeting · ref(today)=2026-09-16 · **20/20 correct**
- phrase: `tomorrow at 9am` · confirmed values seen: true
- wrong answers: (none)

**D4** (D · relative) — exp `2026-09-20T12:00` in meeting · ref(today)=2026-09-18 · **20/20 correct**
- phrase: `in two days at noon` · confirmed values seen: false
- wrong answers: (none)

**E1** (E · explicit+year) — exp `2027-06-15 (date only)` in key_date · ref(today)=2026-09-14 · **20/20 correct**
- phrase: `closing 15 June 2027` · confirmed values seen: undefined
- wrong answers: (none)

**E2** (E · explicit+year) — exp `2026-10-12T13:00` in meeting · ref(today)=2026-09-15 · **20/20 correct**
- phrase: `12 October 2026 at 1pm` · confirmed values seen: true
- wrong answers: (none)

**E3** (E · explicit+year) — exp `2027-02-28 (date only)` in key_date · ref(today)=2026-09-16 · **20/20 correct**
- phrase: `final payment due 28 February 2027` · confirmed values seen: undefined
- wrong answers: (none)

**F1** (F · time-only same-day) — exp `2026-09-14T18:00` in meeting · ref(today)=2026-09-14 · **20/20 correct**
- phrase: `call at 6 this evening` · confirmed values seen: false
- wrong answers: (none)

**F2** (F · time-only same-day) — exp `2026-09-15T15:00` in meeting · ref(today)=2026-09-15 · **20/20 correct**
- phrase: `at 3 this afternoon` · confirmed values seen: true/false
- wrong answers: (none)

**F3** (F · time-only same-day) — exp `2026-09-16T20:00` in meeting · ref(today)=2026-09-16 · **20/20 correct**
- phrase: `call at 8 tonight` · confirmed values seen: false
- wrong answers: (none)

**G1** (G · code-switched (AR-EN)) — exp `2027-10-20T11:00` in meeting · ref(today)=2026-09-14 · **20/20 correct**
- phrase: `20 October 2027 الساعة 11` · confirmed values seen: true
- wrong answers: (none)

**G2** (G · code-switched (HI-EN)) — exp `2027-05-05T16:00` in meeting · ref(today)=2026-09-15 · **17/20 correct**
- phrase: `5 May 2027 ko 4pm` · confirmed values seen: undefined/true
- wrong answers: wrong-time (none) ×3

**G3** (G · code-switched (AR-EN, relative)) — exp `2026-09-16T14:00` in meeting · ref(today)=2026-09-15 · **14/20 correct**
- phrase: `bukra الساعة 2` · confirmed values seen: false/true
- wrong answers: silent-miss ×6

**G4** (G · code-switched (HI-EN, weekday)) — exp `2026-09-16T10:00` in meeting · ref(today)=2026-09-14 · **20/20 correct**
- phrase: `Wednesday ko 10 baje` · confirmed values seen: true/false
- wrong answers: (none)
