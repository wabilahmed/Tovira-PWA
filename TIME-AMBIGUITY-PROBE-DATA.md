# Time-ambiguity probe — DATA (machine record)

Run 2026-09-15T04:18:32.968Z · prompt `tovira-extract-v0.9.5` UNCHANGED · model `claude-sonnet-5` · today 2026-09-15 (Tuesday) · 5 runs/input.
Nothing was changed: no prompt, schema, gate, or fixture edits. Chat inputs rendered as production renders a thread ("[ISO] sender: body").

**Total model spend: $2.1800 (AED 8.01)** across 90 probe calls + 2 warm-up. Cache read observed on every input: YES.


---

## A1 — A · explicit range
- **client:** Rashid Al Falasi · **source:** whatsapp_export · **ambiguous phrase:** `between 1-4pm`
```
[2026-09-14T18:03:00] Rashid: salaam, can we do the villa viewing tomorrow?
[2026-09-14T18:05:00] Me: sure, what time works for you?
[2026-09-14T18:06:00] Rashid: let's meet somewhere between 1-4pm
```
- **landed-in across 5 runs:** meeting | meeting | meeting | meeting | meeting  →  CONSISTENT
- **meeting.datetime across runs:** · | · | · | · | ·  →  consistent
- **meeting.datetime_raw across runs:** "tomorrow, between 1-4pm" | "tomorrow, somewhere between 1-4pm" | "tomorrow, between 1-4pm" | "tomorrow, somewhere between 1-4pm" | "tomorrow, between 1-4pm"
- **meeting.source_span across runs:** "let's meet somewhere between 1-4pm" | "let's meet somewhere between 1-4pm" | "let's meet somewhere between 1-4pm" | "let's meet somewhere between 1-4pm" | "let's meet somewhere between 1-4pm"
- **meeting.source_message_at across runs:** 2026-09-14T18:06:00 | 2026-09-14T18:06:00 | 2026-09-14T18:06:00 | 2026-09-14T18:06:00 | 2026-09-14T18:06:00

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "tomorrow, between 1-4pm",
    "confirmed": false,
    "source_span": "let's meet somewhere between 1-4pm",
    "source_message_at": "2026-09-14T18:06:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "tomorrow, somewhere between 1-4pm",
    "confirmed": false,
    "source_span": "let's meet somewhere between 1-4pm",
    "source_message_at": "2026-09-14T18:06:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "tomorrow, between 1-4pm",
    "confirmed": false,
    "source_span": "let's meet somewhere between 1-4pm",
    "source_message_at": "2026-09-14T18:06:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "tomorrow, somewhere between 1-4pm",
    "confirmed": false,
    "source_span": "let's meet somewhere between 1-4pm",
    "source_message_at": "2026-09-14T18:06:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "tomorrow, between 1-4pm",
    "confirmed": false,
    "source_span": "let's meet somewhere between 1-4pm",
    "source_message_at": "2026-09-14T18:06:00"
  },
  "promises": [],
  "key_dates": []
}
```

</details>

---

## A2 — A · explicit range
- **client:** Fatima Noor · **source:** whatsapp_export · **ambiguous phrase:** `10 to 12 tomorrow`
```
[2026-09-14T09:15:00] Me: when are you free for the Marina apartment handover?
[2026-09-14T09:20:00] Fatima: I'm free 10 to 12 tomorrow
```
- **landed-in across 5 runs:** meeting | meeting | meeting | meeting | meeting  →  CONSISTENT
- **meeting.datetime across runs:** · | · | · | 2026-09-15T10:00 | 2026-09-15T10:00  →  DISAGREEMENT
- **meeting.datetime_raw across runs:** "10 to 12 tomorrow" | "10 to 12 tomorrow" | "10 to 12 tomorrow" | "10 to 12 tomorrow" | "10 to 12 tomorrow"
- **meeting.source_span across runs:** "I'm free 10 to 12 tomorrow" | "I'm free 10 to 12 tomorrow" | "I'm free 10 to 12 tomorrow" | "I'm free 10 to 12 tomorrow" | "I'm free 10 to 12 tomorrow"
- **meeting.source_message_at across runs:** 2026-09-14T09:20:00 | 2026-09-14T09:20:00 | 2026-09-14T09:20 | 2026-09-14T09:20 | 2026-09-14T09:20:00

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "10 to 12 tomorrow",
    "confirmed": false,
    "source_span": "I'm free 10 to 12 tomorrow",
    "source_message_at": "2026-09-14T09:20:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "10 to 12 tomorrow",
    "confirmed": false,
    "source_span": "I'm free 10 to 12 tomorrow",
    "source_message_at": "2026-09-14T09:20:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "10 to 12 tomorrow",
    "confirmed": false,
    "source_span": "I'm free 10 to 12 tomorrow",
    "source_message_at": "2026-09-14T09:20"
  },
  "promises": [],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": {
    "datetime": "2026-09-15T10:00",
    "datetime_raw": "10 to 12 tomorrow",
    "confirmed": false,
    "source_span": "I'm free 10 to 12 tomorrow",
    "source_message_at": "2026-09-14T09:20"
  },
  "promises": [],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": {
    "datetime": "2026-09-15T10:00",
    "datetime_raw": "10 to 12 tomorrow",
    "confirmed": false,
    "source_span": "I'm free 10 to 12 tomorrow",
    "source_message_at": "2026-09-14T09:20:00"
  },
  "promises": [],
  "key_dates": []
}
```

</details>

---

## A3 — A · explicit range
- **client:** Khalid Rahman · **source:** whatsapp_export · **ambiguous phrase:** `between Thursday and Saturday`
```
[2026-09-13T11:00:00] Me: when can we schedule the Dubai Hills site tour?
[2026-09-13T11:12:00] Khalid: anytime between Thursday and Saturday works for me
```
- **landed-in across 5 runs:** meeting | meeting | meeting | meeting | meeting  →  CONSISTENT
- **meeting.datetime across runs:** · | · | · | · | ·  →  consistent
- **meeting.datetime_raw across runs:** "Thursday and Saturday" | "anytime between Thursday and Saturday" | "anytime between Thursday and Saturday" | "anytime between Thursday and Saturday" | "anytime between Thursday and Saturday"
- **meeting.source_span across runs:** "anytime between Thursday and Saturday works for me" | "anytime between Thursday and Saturday works for me" | "anytime between Thursday and Saturday works for me" | "anytime between Thursday and Saturday works for me" | "anytime between Thursday and Saturday works for me"
- **meeting.source_message_at across runs:** 2026-09-13T11:12:00 | 2026-09-13T11:12:00 | 2026-09-13T11:12 | 2026-09-13T11:12:00 | 2026-09-13T11:12:00

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "Thursday and Saturday",
    "confirmed": false,
    "source_span": "anytime between Thursday and Saturday works for me",
    "source_message_at": "2026-09-13T11:12:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "anytime between Thursday and Saturday",
    "confirmed": false,
    "source_span": "anytime between Thursday and Saturday works for me",
    "source_message_at": "2026-09-13T11:12:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "anytime between Thursday and Saturday",
    "confirmed": false,
    "source_span": "anytime between Thursday and Saturday works for me",
    "source_message_at": "2026-09-13T11:12"
  },
  "promises": [],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "anytime between Thursday and Saturday",
    "confirmed": false,
    "source_span": "anytime between Thursday and Saturday works for me",
    "source_message_at": "2026-09-13T11:12:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "anytime between Thursday and Saturday",
    "confirmed": false,
    "source_span": "anytime between Thursday and Saturday works for me",
    "source_message_at": "2026-09-13T11:12:00"
  },
  "promises": [],
  "key_dates": []
}
```

</details>

---

## B1 — B · self-correction
- **client:** Bilal Ahmed · **source:** whatsapp_export · **ambiguous phrase:** `at 2 2:30 pm`
```
[2026-09-14T20:01:00] Bilal: bro let's do the meeting at 2 2:30 pm tomorrow for the mortgage docs
[2026-09-14T20:02:00] Me: got it
```
- **landed-in across 5 runs:** meeting | meeting | meeting | meeting | meeting  →  CONSISTENT
- **meeting.datetime across runs:** · | 2026-09-15T14:30 | · | 2026-09-15T14:30 | 2026-09-15T14:30  →  DISAGREEMENT
- **meeting.datetime_raw across runs:** "2 2:30 pm tomorrow" | "2 2:30 pm tomorrow" | "2 2:30 pm tomorrow" | "2 2:30 pm tomorrow" | "2 2:30 pm tomorrow"
- **meeting.source_span across runs:** "let's do the meeting at 2 2:30 pm tomorrow for the mortgage docs" | "let's do the meeting at 2 2:30 pm tomorrow for the mortgage docs" | "let's do the meeting at 2 2:30 pm tomorrow for the mortgage docs" | "let's do the meeting at 2 2:30 pm tomorrow for the mortgage docs" | "let's do the meeting at 2 2:30 pm tomorrow for the mortgage docs"
- **meeting.source_message_at across runs:** 2026-09-14T20:01 | 2026-09-14T20:01 | 2026-09-14T20:01 | 2026-09-14T20:01 | 2026-09-14T20:01

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "2 2:30 pm tomorrow",
    "confirmed": true,
    "source_span": "let's do the meeting at 2 2:30 pm tomorrow for the mortgage docs",
    "source_message_at": "2026-09-14T20:01"
  },
  "promises": [],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": {
    "datetime": "2026-09-15T14:30",
    "datetime_raw": "2 2:30 pm tomorrow",
    "confirmed": true,
    "source_span": "let's do the meeting at 2 2:30 pm tomorrow for the mortgage docs",
    "source_message_at": "2026-09-14T20:01"
  },
  "promises": [],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "2 2:30 pm tomorrow",
    "confirmed": false,
    "source_span": "let's do the meeting at 2 2:30 pm tomorrow for the mortgage docs",
    "source_message_at": "2026-09-14T20:01"
  },
  "promises": [],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": {
    "datetime": "2026-09-15T14:30",
    "datetime_raw": "2 2:30 pm tomorrow",
    "confirmed": true,
    "source_span": "let's do the meeting at 2 2:30 pm tomorrow for the mortgage docs",
    "source_message_at": "2026-09-14T20:01"
  },
  "promises": [],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": {
    "datetime": "2026-09-15T14:30",
    "datetime_raw": "2 2:30 pm tomorrow",
    "confirmed": true,
    "source_span": "let's do the meeting at 2 2:30 pm tomorrow for the mortgage docs",
    "source_message_at": "2026-09-14T20:01"
  },
  "promises": [],
  "key_dates": []
}
```

</details>

---

## B2 — B · self-correction
- **client:** Sana Malik · **source:** whatsapp_export · **ambiguous phrase:** `Monday — no wait, Tuesday`
```
[2026-09-14T14:30:00] Me: which day should I block for the contract signing?
[2026-09-14T14:33:00] Sana: Monday — no wait, Tuesday
```
- **landed-in across 5 runs:** meeting | meeting | meeting | meeting | meeting  →  CONSISTENT
- **meeting.datetime across runs:** · | · | · | 2026-09-15T00:00 | ·  →  DISAGREEMENT
- **meeting.datetime_raw across runs:** "Monday — no wait, Tuesday" | "Tuesday" | "Monday — no wait, Tuesday" | "Tuesday" | "Tuesday"
- **meeting.source_span across runs:** "Monday — no wait, Tuesday" | "Monday — no wait, Tuesday" | "Monday — no wait, Tuesday" | "Monday — no wait, Tuesday" | "Monday — no wait, Tuesday"
- **meeting.source_message_at across runs:** 2026-09-14T14:33:00 | 2026-09-14T14:33:00 | 2026-09-14T14:33:00 | 2026-09-14T14:33:00 | 2026-09-14T14:33:00

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "Monday — no wait, Tuesday",
    "confirmed": false,
    "source_span": "Monday — no wait, Tuesday",
    "source_message_at": "2026-09-14T14:33:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "Tuesday",
    "confirmed": false,
    "source_span": "Monday — no wait, Tuesday",
    "source_message_at": "2026-09-14T14:33:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "Monday — no wait, Tuesday",
    "confirmed": false,
    "source_span": "Monday — no wait, Tuesday",
    "source_message_at": "2026-09-14T14:33:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": {
    "datetime": "2026-09-15T00:00",
    "datetime_raw": "Tuesday",
    "confirmed": true,
    "source_span": "Monday — no wait, Tuesday",
    "source_message_at": "2026-09-14T14:33:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "Tuesday",
    "confirmed": false,
    "source_span": "Monday — no wait, Tuesday",
    "source_message_at": "2026-09-14T14:33:00"
  },
  "promises": [],
  "key_dates": []
}
```

</details>

---

## B3 — B · self-correction
- **client:** Aisha Khan · **source:** whatsapp_export · **ambiguous phrase:** `at 5, actually make it 6`
```
[2026-09-14T17:45:00] Aisha: call me at 5, actually make it 6
[2026-09-14T17:46:00] Me: noted, will call at 6
```
- **landed-in across 5 runs:** meeting | meeting+promise | meeting+promise | meeting | meeting  →  DISAGREEMENT
- **meeting.datetime across runs:** 2026-09-14T18:00 | · | 2026-09-14T18:00 | · | 2026-09-14T18:00  →  DISAGREEMENT
- **meeting.datetime_raw across runs:** "call me at 5, actually make it 6" | "6" | "6" | "call me at 5, actually make it 6" | "6"
- **meeting.source_span across runs:** "call me at 5, actually make it 6" | "noted, will call at 6" | "actually make it 6" | "call me at 5, actually make it 6" | "noted, will call at 6"
- **meeting.source_message_at across runs:** 2026-09-14T17:45 | 2026-09-14T17:46:00 | 2026-09-14T17:45:00 | 2026-09-14T17:45:00 | 2026-09-14T17:46

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": {
    "datetime": "2026-09-14T18:00",
    "datetime_raw": "call me at 5, actually make it 6",
    "confirmed": true,
    "source_span": "call me at 5, actually make it 6",
    "source_message_at": "2026-09-14T17:45"
  },
  "promises": [],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "6",
    "confirmed": true,
    "source_span": "noted, will call at 6",
    "source_message_at": "2026-09-14T17:46:00"
  },
  "promises": [
    {
      "text": "Call Aisha at 6",
      "owner": "rep",
      "due_date": null,
      "due_raw": "6",
      "confidence": "high",
      "source_span": "noted, will call at 6",
      "source_message_at": "2026-09-14T17:46:00"
    }
  ],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": {
    "datetime": "2026-09-14T18:00",
    "datetime_raw": "6",
    "confirmed": true,
    "source_span": "actually make it 6",
    "source_message_at": "2026-09-14T17:45:00"
  },
  "promises": [
    {
      "text": "Call Aisha at 6",
      "owner": "rep",
      "due_date": "2026-09-14",
      "due_raw": "6",
      "confidence": "high",
      "source_span": "will call at 6",
      "source_message_at": "2026-09-14T17:46:00"
    }
  ],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "call me at 5, actually make it 6",
    "confirmed": true,
    "source_span": "call me at 5, actually make it 6",
    "source_message_at": "2026-09-14T17:45:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": {
    "datetime": "2026-09-14T18:00",
    "datetime_raw": "6",
    "confirmed": true,
    "source_span": "noted, will call at 6",
    "source_message_at": "2026-09-14T17:46"
  },
  "promises": [],
  "key_dates": []
}
```

</details>

---

## C1 — C · religious/cultural
- **client:** Yusuf Ibrahim · **source:** whatsapp_export · **ambiguous phrase:** `after Asr`
```
[2026-09-14T13:00:00] Me: when should I come by with the tenancy contract?
[2026-09-14T13:10:00] Yusuf: after Asr
```
- **landed-in across 5 runs:** meeting | meeting | meeting+promise | meeting | meeting  →  DISAGREEMENT
- **meeting.datetime across runs:** · | · | · | · | ·  →  consistent
- **meeting.datetime_raw across runs:** "after Asr" | "after Asr" | "after Asr" | "after Asr" | "after Asr"
- **meeting.source_span across runs:** "after Asr" | "after Asr" | "after Asr" | "after Asr" | "after Asr"
- **meeting.source_message_at across runs:** 2026-09-14T13:10:00 | 2026-09-14T13:10 | 2026-09-14T13:10 | 2026-09-14T13:10:00 | 2026-09-14T13:10:00

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "after Asr",
    "confirmed": true,
    "source_span": "after Asr",
    "source_message_at": "2026-09-14T13:10:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "after Asr",
    "confirmed": true,
    "source_span": "after Asr",
    "source_message_at": "2026-09-14T13:10"
  },
  "promises": [],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "after Asr",
    "confirmed": true,
    "source_span": "after Asr",
    "source_message_at": "2026-09-14T13:10"
  },
  "promises": [
    {
      "text": "Come by with the tenancy contract",
      "owner": "rep",
      "due_date": null,
      "due_raw": "after Asr",
      "confidence": "high",
      "source_span": "when should I come by with the tenancy contract?",
      "source_message_at": "2026-09-14T13:00"
    }
  ],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "after Asr",
    "confirmed": true,
    "source_span": "after Asr",
    "source_message_at": "2026-09-14T13:10:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "after Asr",
    "confirmed": true,
    "source_span": "after Asr",
    "source_message_at": "2026-09-14T13:10:00"
  },
  "promises": [],
  "key_dates": []
}
```

</details>

---

## C2 — C · religious/cultural
- **client:** Mariam Saleh · **source:** whatsapp_export · **ambiguous phrase:** `بعد المغرب around 8`
```
[2026-09-14T16:20:00] Me: what time tomorrow for the handover?
[2026-09-14T16:25:00] Mariam: بعد المغرب around 8
```
- **landed-in across 5 runs:** meeting | meeting | meeting | meeting | meeting  →  CONSISTENT
- **meeting.datetime across runs:** 2026-09-16T20:00 | 2026-09-15T20:00 | · | · | ·  →  DISAGREEMENT
- **meeting.datetime_raw across runs:** "tomorrow, بعد المغرب around 8" | "tomorrow, بعد المغرب around 8" | "tomorrow, بعد المغرب around 8" | "بعد المغرب around 8" | "tomorrow, بعد المغرب around 8"
- **meeting.source_span across runs:** "بعد المغرب around 8" | "بعد المغرب around 8" | "بعد المغرب around 8" | "بعد المغرب around 8" | "بعد المغرب around 8"
- **meeting.source_message_at across runs:** 2026-09-14T16:25:00 | 2026-09-14T16:25 | 2026-09-14T16:25:00 | 2026-09-14T16:25:00 | 2026-09-14T16:25:00

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": {
    "datetime": "2026-09-16T20:00",
    "datetime_raw": "tomorrow, بعد المغرب around 8",
    "confirmed": false,
    "source_span": "بعد المغرب around 8",
    "source_message_at": "2026-09-14T16:25:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": {
    "datetime": "2026-09-15T20:00",
    "datetime_raw": "tomorrow, بعد المغرب around 8",
    "confirmed": true,
    "source_span": "بعد المغرب around 8",
    "source_message_at": "2026-09-14T16:25"
  },
  "promises": [],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "tomorrow, بعد المغرب around 8",
    "confirmed": true,
    "source_span": "بعد المغرب around 8",
    "source_message_at": "2026-09-14T16:25:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "بعد المغرب around 8",
    "confirmed": false,
    "source_span": "بعد المغرب around 8",
    "source_message_at": "2026-09-14T16:25:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "tomorrow, بعد المغرب around 8",
    "confirmed": true,
    "source_span": "بعد المغرب around 8",
    "source_message_at": "2026-09-14T16:25:00"
  },
  "promises": [],
  "key_dates": []
}
```

</details>

---

## C3 — C · religious/cultural
- **client:** Omar Siddiqui · **source:** whatsapp_export · **ambiguous phrase:** `before Jummah on Friday`
```
[2026-09-11T10:00:00] Me: can we finalize the insurance renewal this week?
[2026-09-11T10:05:00] Omar: before Jummah on Friday inshallah
```
- **landed-in across 5 runs:** promise | promise | promise | promise | promise  →  CONSISTENT
- **meeting.datetime across runs:** · | · | · | · | ·  →  consistent
- **meeting.datetime_raw across runs:** "·" | "·" | "·" | "·" | "·"
- **meeting.source_span across runs:** null | null | null | null | null
- **meeting.source_message_at across runs:** · | · | · | · | ·

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": null,
  "promises": [
    {
      "text": "Finalize the insurance renewal",
      "owner": "client",
      "due_date": "2026-09-11",
      "due_raw": "before Jummah on Friday",
      "confidence": "low",
      "source_span": "before Jummah on Friday inshallah",
      "source_message_at": "2026-09-11T10:05:00"
    }
  ],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": null,
  "promises": [
    {
      "text": "Finalize the insurance renewal before Friday",
      "owner": "client",
      "due_date": null,
      "due_raw": "before Jummah on Friday",
      "confidence": "low",
      "source_span": "before Jummah on Friday inshallah",
      "source_message_at": "2026-09-11T10:05:00"
    }
  ],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": null,
  "promises": [
    {
      "text": "Finalize the insurance renewal before Friday (Jummah)",
      "owner": "client",
      "due_date": null,
      "due_raw": "before Jummah on Friday inshallah",
      "confidence": "low",
      "source_span": "before Jummah on Friday inshallah",
      "source_message_at": "2026-09-11T10:05:00"
    }
  ],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": null,
  "promises": [
    {
      "text": "Finalize the insurance renewal before Friday's Jummah prayer",
      "owner": "client",
      "due_date": "2026-09-18",
      "due_raw": "before Jummah on Friday inshallah",
      "confidence": "high",
      "source_span": "before Jummah on Friday inshallah",
      "source_message_at": "2026-09-11T10:05"
    }
  ],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": null,
  "promises": [
    {
      "text": "Finalize the insurance renewal before Jummah on Friday",
      "owner": "client",
      "due_date": null,
      "due_raw": "before Jummah on Friday",
      "confidence": "low",
      "source_span": "before Jummah on Friday inshallah",
      "source_message_at": "2026-09-11T10:05"
    }
  ],
  "key_dates": []
}
```

</details>

---

## D1 — D · vague
- **client:** Hind Al Marri · **source:** whatsapp_export · **ambiguous phrase:** `next week sometime`
```
[2026-09-14T12:00:00] Me: when do you want to see the JVC townhouses?
[2026-09-14T12:15:00] Hind: next week sometime
```
- **landed-in across 5 runs:** meeting | meeting | meeting | meeting | meeting  →  CONSISTENT
- **meeting.datetime across runs:** · | · | · | · | ·  →  consistent
- **meeting.datetime_raw across runs:** "next week sometime" | "next week sometime" | "next week sometime" | "next week sometime" | "next week sometime"
- **meeting.source_span across runs:** "next week sometime" | "next week sometime" | "next week sometime" | "next week sometime" | "next week sometime"
- **meeting.source_message_at across runs:** 2026-09-14T12:15 | 2026-09-14T12:15 | 2026-09-14T12:15 | 2026-09-14T12:15:00 | 2026-09-14T12:15

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "next week sometime",
    "confirmed": false,
    "source_span": "next week sometime",
    "source_message_at": "2026-09-14T12:15"
  },
  "promises": [],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "next week sometime",
    "confirmed": false,
    "source_span": "next week sometime",
    "source_message_at": "2026-09-14T12:15"
  },
  "promises": [],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "next week sometime",
    "confirmed": false,
    "source_span": "next week sometime",
    "source_message_at": "2026-09-14T12:15"
  },
  "promises": [],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "next week sometime",
    "confirmed": false,
    "source_span": "next week sometime",
    "source_message_at": "2026-09-14T12:15:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "next week sometime",
    "confirmed": false,
    "source_span": "next week sometime",
    "source_message_at": "2026-09-14T12:15"
  },
  "promises": [],
  "key_dates": []
}
```

</details>

---

## D2 — D · vague
- **client:** Ravi Kumar · **source:** whatsapp_export · **ambiguous phrase:** `end of the month`
```
[2026-09-14T15:00:00] Ravi: I'll transfer the booking deposit end of the month
[2026-09-14T15:01:00] Me: perfect, thanks
```
- **landed-in across 5 runs:** promise | promise | promise | promise | promise  →  CONSISTENT
- **meeting.datetime across runs:** · | · | · | · | ·  →  consistent
- **meeting.datetime_raw across runs:** "·" | "·" | "·" | "·" | "·"
- **meeting.source_span across runs:** null | null | null | null | null
- **meeting.source_message_at across runs:** · | · | · | · | ·

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": null,
  "promises": [
    {
      "text": "Transfer the booking deposit",
      "owner": "client",
      "due_date": null,
      "due_raw": "end of the month",
      "confidence": "high",
      "source_span": "I'll transfer the booking deposit end of the month",
      "source_message_at": "2026-09-14T15:00"
    }
  ],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": null,
  "promises": [
    {
      "text": "Transfer the booking deposit",
      "owner": "client",
      "due_date": "2026-09-30",
      "due_raw": "end of the month",
      "confidence": "high",
      "source_span": "I'll transfer the booking deposit end of the month",
      "source_message_at": "2026-09-14T15:00"
    }
  ],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": null,
  "promises": [
    {
      "text": "Transfer the booking deposit",
      "owner": "client",
      "due_date": null,
      "due_raw": "end of the month",
      "confidence": "high",
      "source_span": "I'll transfer the booking deposit end of the month",
      "source_message_at": "2026-09-14T15:00"
    }
  ],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": null,
  "promises": [
    {
      "text": "Transfer the booking deposit",
      "owner": "client",
      "due_date": "2026-09-30",
      "due_raw": "end of the month",
      "confidence": "high",
      "source_span": "I'll transfer the booking deposit end of the month",
      "source_message_at": "2026-09-14T15:00"
    }
  ],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": null,
  "promises": [
    {
      "text": "Transfer the booking deposit",
      "owner": "client",
      "due_date": null,
      "due_raw": "end of the month",
      "confidence": "high",
      "source_span": "I'll transfer the booking deposit end of the month",
      "source_message_at": "2026-09-14T15:00"
    }
  ],
  "key_dates": []
}
```

</details>

---

## D3 — D · vague
- **client:** Layla Hassan · **source:** whatsapp_export · **ambiguous phrase:** `morning is better for me`
```
[2026-09-14T08:30:00] Me: morning or evening for the viewing?
[2026-09-14T08:35:00] Layla: morning is better for me
```
- **landed-in across 5 runs:** none | none | none | meeting | none  →  DISAGREEMENT
- **meeting.datetime across runs:** · | · | · | · | ·  →  consistent
- **meeting.datetime_raw across runs:** "·" | "·" | "·" | "morning" | "·"
- **meeting.source_span across runs:** null | null | null | "morning is better for me" | null
- **meeting.source_message_at across runs:** · | · | · | 2026-09-14T08:35:00 | ·

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": null,
  "promises": [],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": null,
  "promises": [],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": null,
  "promises": [],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "morning",
    "confirmed": false,
    "source_span": "morning is better for me",
    "source_message_at": "2026-09-14T08:35:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": null,
  "promises": [],
  "key_dates": []
}
```

</details>

---

## D4 — D · vague
- **client:** Tariq Aziz · **source:** whatsapp_export · **ambiguous phrase:** `in shaa Allah tomorrow`
```
[2026-09-14T19:00:00] Me: are we still on for the office viewing?
[2026-09-14T19:10:00] Tariq: in shaa Allah tomorrow
```
- **landed-in across 5 runs:** meeting | meeting | meeting | meeting | meeting  →  CONSISTENT
- **meeting.datetime across runs:** 2026-09-15 | · | · | 2026-09-16T00:00 | 2026-09-16  →  DISAGREEMENT
- **meeting.datetime_raw across runs:** "tomorrow" | "tomorrow" | "tomorrow" | "tomorrow" | "tomorrow"
- **meeting.source_span across runs:** "in shaa Allah tomorrow" | "in shaa Allah tomorrow" | "in shaa Allah tomorrow" | "in shaa Allah tomorrow" | "in shaa Allah tomorrow"
- **meeting.source_message_at across runs:** 2026-09-14T19:10:00 | 2026-09-14T19:10:00 | 2026-09-14T19:10:00 | 2026-09-14T19:10:00 | 2026-09-14T19:10

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": {
    "datetime": "2026-09-15",
    "datetime_raw": "tomorrow",
    "confirmed": false,
    "source_span": "in shaa Allah tomorrow",
    "source_message_at": "2026-09-14T19:10:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "tomorrow",
    "confirmed": false,
    "source_span": "in shaa Allah tomorrow",
    "source_message_at": "2026-09-14T19:10:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "tomorrow",
    "confirmed": false,
    "source_span": "in shaa Allah tomorrow",
    "source_message_at": "2026-09-14T19:10:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": {
    "datetime": "2026-09-16T00:00",
    "datetime_raw": "tomorrow",
    "confirmed": true,
    "source_span": "in shaa Allah tomorrow",
    "source_message_at": "2026-09-14T19:10:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": {
    "datetime": "2026-09-16",
    "datetime_raw": "tomorrow",
    "confirmed": true,
    "source_span": "in shaa Allah tomorrow",
    "source_message_at": "2026-09-14T19:10"
  },
  "promises": [],
  "key_dates": []
}
```

</details>

---

## E1 — E · code-switched
- **client:** Nadia Fares · **source:** whatsapp_export · **ambiguous phrase:** `bukra بعد الظهر, maybe 3 or 4`
```
[2026-09-14T11:00:00] Nadia: يعني نلتقي bukra بعد الظهر, maybe 3 or 4
[2026-09-14T11:02:00] Me: ok works for me
```
- **landed-in across 5 runs:** meeting | meeting | meeting | meeting | meeting  →  CONSISTENT
- **meeting.datetime across runs:** · | · | · | · | ·  →  consistent
- **meeting.datetime_raw across runs:** "bukra بعد الظهر, maybe 3 or 4" | "bukra بعد الظهر, maybe 3 or 4" | "bukra بعد الظهر, maybe 3 or 4" | "bukra بعد الظهر, maybe 3 or 4" | "bukra بعد الظهر, maybe 3 or 4"
- **meeting.source_span across runs:** "يعني نلتقي bukra بعد الظهر, maybe 3 or 4" | "يعني نلتقي bukra بعد الظهر, maybe 3 or 4" | "يعني نلتقي bukra بعد الظهر, maybe 3 or 4" | "نلتقي bukra بعد الظهر, maybe 3 or 4" | "يعني نلتقي bukra بعد الظهر, maybe 3 or 4"
- **meeting.source_message_at across runs:** 2026-09-14T11:00 | 2026-09-14T11:00:00 | 2026-09-14T11:00 | 2026-09-14T11:00 | 2026-09-14T11:00

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "bukra بعد الظهر, maybe 3 or 4",
    "confirmed": true,
    "source_span": "يعني نلتقي bukra بعد الظهر, maybe 3 or 4",
    "source_message_at": "2026-09-14T11:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "bukra بعد الظهر, maybe 3 or 4",
    "confirmed": false,
    "source_span": "يعني نلتقي bukra بعد الظهر, maybe 3 or 4",
    "source_message_at": "2026-09-14T11:00:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "bukra بعد الظهر, maybe 3 or 4",
    "confirmed": true,
    "source_span": "يعني نلتقي bukra بعد الظهر, maybe 3 or 4",
    "source_message_at": "2026-09-14T11:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "bukra بعد الظهر, maybe 3 or 4",
    "confirmed": true,
    "source_span": "نلتقي bukra بعد الظهر, maybe 3 or 4",
    "source_message_at": "2026-09-14T11:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "bukra بعد الظهر, maybe 3 or 4",
    "confirmed": true,
    "source_span": "يعني نلتقي bukra بعد الظهر, maybe 3 or 4",
    "source_message_at": "2026-09-14T11:00"
  },
  "promises": [],
  "key_dates": []
}
```

</details>

---

## E2 — E · code-switched
- **client:** Vikram Singh · **source:** whatsapp_export · **ambiguous phrase:** `kal shaam ko, around 7 baje`
```
[2026-09-14T18:30:00] Vikram: bhai kal shaam ko milte hain, around 7 baje
[2026-09-14T18:31:00] Me: theek hai
```
- **landed-in across 5 runs:** meeting | meeting | meeting | meeting | meeting  →  CONSISTENT
- **meeting.datetime across runs:** 2026-09-15T19:00 | 2026-09-15T19:00 | 2026-09-15T19:00 | 2026-09-16T19:00 | 2026-09-15T19:00  →  DISAGREEMENT
- **meeting.datetime_raw across runs:** "kal shaam ko, around 7 baje" | "kal shaam ko, around 7 baje" | "kal shaam ko, around 7 baje" | "kal shaam ko, around 7 baje" | "kal shaam ko milte hain, around 7 baje"
- **meeting.source_span across runs:** "bhai kal shaam ko milte hain, around 7 baje" | "kal shaam ko milte hain, around 7 baje" | "bhai kal shaam ko milte hain, around 7 baje" | "kal shaam ko milte hain, around 7 baje" | "bhai kal shaam ko milte hain, around 7 baje"
- **meeting.source_message_at across runs:** 2026-09-14T18:30:00 | 2026-09-14T18:30 | 2026-09-14T18:30 | 2026-09-14T18:30 | 2026-09-14T18:30

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": {
    "datetime": "2026-09-15T19:00",
    "datetime_raw": "kal shaam ko, around 7 baje",
    "confirmed": true,
    "source_span": "bhai kal shaam ko milte hain, around 7 baje",
    "source_message_at": "2026-09-14T18:30:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": {
    "datetime": "2026-09-15T19:00",
    "datetime_raw": "kal shaam ko, around 7 baje",
    "confirmed": true,
    "source_span": "kal shaam ko milte hain, around 7 baje",
    "source_message_at": "2026-09-14T18:30"
  },
  "promises": [],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": {
    "datetime": "2026-09-15T19:00",
    "datetime_raw": "kal shaam ko, around 7 baje",
    "confirmed": true,
    "source_span": "bhai kal shaam ko milte hain, around 7 baje",
    "source_message_at": "2026-09-14T18:30"
  },
  "promises": [],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": {
    "datetime": "2026-09-16T19:00",
    "datetime_raw": "kal shaam ko, around 7 baje",
    "confirmed": true,
    "source_span": "kal shaam ko milte hain, around 7 baje",
    "source_message_at": "2026-09-14T18:30"
  },
  "promises": [],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": {
    "datetime": "2026-09-15T19:00",
    "datetime_raw": "kal shaam ko milte hain, around 7 baje",
    "confirmed": true,
    "source_span": "bhai kal shaam ko milte hain, around 7 baje",
    "source_message_at": "2026-09-14T18:30"
  },
  "promises": [],
  "key_dates": []
}
```

</details>

---

## E3 — E · code-switched
- **client:** Zoya Iqbal · **source:** whatsapp_export · **ambiguous phrase:** `kal ya parso, subah ke waqt`
```
[2026-09-14T21:00:00] Me: when can you come sign the insurance papers?
[2026-09-14T21:05:00] Zoya: kal ya parso, subah ke waqt theek rahega
```
- **landed-in across 5 runs:** meeting+promise | promise | meeting+promise | meeting+promise | promise  →  DISAGREEMENT
- **meeting.datetime across runs:** · | · | · | · | ·  →  consistent
- **meeting.datetime_raw across runs:** "kal ya parso, subah ke waqt (tomorrow or day after tomorrow, morning)" | "·" | "kal ya parso, subah ke waqt" | "kal ya parso, subah ke waqt (tomorrow or day after tomorrow, morning time)" | "·"
- **meeting.source_span across runs:** "kal ya parso, subah ke waqt theek rahega" | null | "kal ya parso, subah ke waqt theek rahega" | "kal ya parso, subah ke waqt theek rahega" | null
- **meeting.source_message_at across runs:** 2026-09-14T21:05 | · | 2026-09-14T21:05:00 | 2026-09-14T21:05:00 | ·

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "kal ya parso, subah ke waqt (tomorrow or day after tomorrow, morning)",
    "confirmed": false,
    "source_span": "kal ya parso, subah ke waqt theek rahega",
    "source_message_at": "2026-09-14T21:05"
  },
  "promises": [
    {
      "text": "Come sign the insurance papers",
      "owner": "client",
      "due_date": null,
      "due_raw": "kal ya parso, subah ke waqt (tomorrow or day after tomorrow, in the morning)",
      "confidence": "low",
      "source_span": "kal ya parso, subah ke waqt theek rahega",
      "source_message_at": "2026-09-14T21:05"
    }
  ],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": null,
  "promises": [
    {
      "text": "Come sign the insurance papers",
      "owner": "client",
      "due_date": null,
      "due_raw": "kal ya parso, subah ke waqt",
      "confidence": "low",
      "source_span": "kal ya parso, subah ke waqt theek rahega",
      "source_message_at": "2026-09-14T21:05:00"
    }
  ],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "kal ya parso, subah ke waqt",
    "confirmed": false,
    "source_span": "kal ya parso, subah ke waqt theek rahega",
    "source_message_at": "2026-09-14T21:05:00"
  },
  "promises": [
    {
      "text": "Come sign the insurance papers",
      "owner": "client",
      "due_date": null,
      "due_raw": "kal ya parso, subah ke waqt",
      "confidence": "low",
      "source_span": "kal ya parso, subah ke waqt theek rahega",
      "source_message_at": "2026-09-14T21:05:00"
    }
  ],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": "kal ya parso, subah ke waqt (tomorrow or day after tomorrow, morning time)",
    "confirmed": false,
    "source_span": "kal ya parso, subah ke waqt theek rahega",
    "source_message_at": "2026-09-14T21:05:00"
  },
  "promises": [
    {
      "text": "Come sign the insurance papers",
      "owner": "client",
      "due_date": null,
      "due_raw": "kal ya parso, subah ke waqt (tomorrow or day after tomorrow, morning time)",
      "confidence": "low",
      "source_span": "kal ya parso, subah ke waqt theek rahega",
      "source_message_at": "2026-09-14T21:05:00"
    }
  ],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": null,
  "promises": [
    {
      "text": "Come sign the insurance papers",
      "owner": "client",
      "due_date": null,
      "due_raw": "kal ya parso, subah ke waqt (tomorrow or day after, in the morning)",
      "confidence": "low",
      "source_span": "kal ya parso, subah ke waqt theek rahega",
      "source_message_at": "2026-09-14T21:05"
    }
  ],
  "key_dates": []
}
```

</details>

---

## F1 — F · control (unambiguous)
- **client:** Sameer Malik · **source:** whatsapp_export · **ambiguous phrase:** `Thursday 3pm`
```
[2026-09-14T10:00:00] Me: confirming our meeting
[2026-09-14T10:01:00] Sameer: yes, meeting Thursday 3pm at your office
```
- **landed-in across 5 runs:** meeting | meeting | meeting | meeting | meeting  →  CONSISTENT
- **meeting.datetime across runs:** 2026-09-17T15:00 | 2026-09-17T15:00 | 2026-09-17T15:00 | 2026-09-16T15:00 | 2026-09-17T15:00  →  DISAGREEMENT
- **meeting.datetime_raw across runs:** "Thursday 3pm" | "Thursday 3pm at your office" | "Thursday 3pm" | "Thursday 3pm" | "Thursday 3pm"
- **meeting.source_span across runs:** "yes, meeting Thursday 3pm at your office" | "yes, meeting Thursday 3pm at your office" | "yes, meeting Thursday 3pm at your office" | "yes, meeting Thursday 3pm at your office" | "meeting Thursday 3pm at your office"
- **meeting.source_message_at across runs:** 2026-09-14T10:01 | 2026-09-14T10:01 | 2026-09-14T10:01:00 | 2026-09-14T10:01:00 | 2026-09-14T10:01

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": {
    "datetime": "2026-09-17T15:00",
    "datetime_raw": "Thursday 3pm",
    "confirmed": true,
    "source_span": "yes, meeting Thursday 3pm at your office",
    "source_message_at": "2026-09-14T10:01"
  },
  "promises": [],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": {
    "datetime": "2026-09-17T15:00",
    "datetime_raw": "Thursday 3pm at your office",
    "confirmed": true,
    "source_span": "yes, meeting Thursday 3pm at your office",
    "source_message_at": "2026-09-14T10:01"
  },
  "promises": [],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": {
    "datetime": "2026-09-17T15:00",
    "datetime_raw": "Thursday 3pm",
    "confirmed": true,
    "source_span": "yes, meeting Thursday 3pm at your office",
    "source_message_at": "2026-09-14T10:01:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": {
    "datetime": "2026-09-16T15:00",
    "datetime_raw": "Thursday 3pm",
    "confirmed": true,
    "source_span": "yes, meeting Thursday 3pm at your office",
    "source_message_at": "2026-09-14T10:01:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": {
    "datetime": "2026-09-17T15:00",
    "datetime_raw": "Thursday 3pm",
    "confirmed": true,
    "source_span": "meeting Thursday 3pm at your office",
    "source_message_at": "2026-09-14T10:01"
  },
  "promises": [],
  "key_dates": []
}
```

</details>

---

## F2 — F · control (no time)
- **client:** Dina Farouk · **source:** whatsapp_export · **ambiguous phrase:** `let's meet (no time)`
```
[2026-09-14T13:00:00] Me: would love to catch up soon
[2026-09-14T13:05:00] Dina: yes let's meet
```
- **landed-in across 5 runs:** none | meeting | none | none | none  →  DISAGREEMENT
- **meeting.datetime across runs:** · | · | · | · | ·  →  consistent
- **meeting.datetime_raw across runs:** "·" | "·" | "·" | "·" | "·"
- **meeting.source_span across runs:** null | "yes let's meet" | null | null | null
- **meeting.source_message_at across runs:** · | 2026-09-14T13:05:00 | · | · | ·

<details><summary>full per-run output</summary>


Run 1:
```json
{
  "meeting": null,
  "promises": [],
  "key_dates": []
}
```

Run 2:
```json
{
  "meeting": {
    "datetime": null,
    "datetime_raw": null,
    "confirmed": false,
    "source_span": "yes let's meet",
    "source_message_at": "2026-09-14T13:05:00"
  },
  "promises": [],
  "key_dates": []
}
```

Run 3:
```json
{
  "meeting": null,
  "promises": [],
  "key_dates": []
}
```

Run 4:
```json
{
  "meeting": null,
  "promises": [],
  "key_dates": []
}
```

Run 5:
```json
{
  "meeting": null,
  "promises": [],
  "key_dates": []
}
```

</details>
