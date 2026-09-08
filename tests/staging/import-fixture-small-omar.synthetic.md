# B1 small fixture — `import-easy-omar` (SYNTHETIC · full-output draft for certification)

Synthetic, so no real customer content enters the repo (your call). ~40 messages over 3 days in
**June 2024**; import reference date (`today`) is **2026-09-08** — two years later, so every relative
date MUST resolve against the *message* date, not the clock (the DATE-REF class). Rep = "Me",
client contact = "Omar Al Mansouri". Certify the expected output below against your judgement, then I
promote it into `eval-set.ts` with `source: 'whatsapp_export'`.

## The synthetic transcript (`WhatsApp_Chat_with_Omar_Al_Mansouri.txt`, dash day-first)

```
03/06/2024, 09:14 - Messages and calls are end-to-end encrypted.
03/06/2024, 09:14 - Me: Morning Omar, good to meet you Sunday. تمام, I'll pull the numbers together.
03/06/2024, 09:31 - Omar Al Mansouri: Morning! Yes was a good session. Send me the revised quote when you can
03/06/2024, 09:33 - Me: Will do — I'll get the revised quote over to you by Thursday.
03/06/2024, 09:34 - Omar Al Mansouri: Perfect إن شاء الله
03/06/2024, 09:40 - Omar Al Mansouri: One thing, the price needs to work. Gulf Distributors quoted us lower last month
03/06/2024, 09:42 - Me: Understood, I'll sharpen it. We're not just the cheapest though, the support is the difference
03/06/2024, 09:43 - Omar Al Mansouri: I know, that's why we're still talking 🙂
03/06/2024, 11:02 - Omar Al Mansouri: Btw Yousef handles the technical side for us, he'll want to review the integration bits
03/06/2024, 11:03 - Me: Great, happy to walk Yousef through it. Is he the one who decides on the technical fit?
03/06/2024, 11:05 - Omar Al Mansouri: He advises. Mr Rahman has the final say on budget, he signs everything off
03/06/2024, 11:06 - Me: Got it. I'll make sure the quote is something you can take to Mr Rahman
04/06/2024, 15:20 - Omar Al Mansouri: Any chance of onboarding support included?
04/06/2024, 15:24 - Me: If Mr Rahman approves the premium tier, I can include onboarding at no extra cost
04/06/2024, 15:25 - Omar Al Mansouri: Noted, let's see the numbers first
04/06/2024, 16:48 - Me: <Media omitted>
04/06/2024, 16:49 - Me: There's the revised quote, sent a couple of days early. AED 84,000 for the year
04/06/2024, 16:55 - Omar Al Mansouri: خلاص got it, will review with Yousef
04/06/2024, 17:30 - Omar Al Mansouri: Looks good honestly. If we go ahead can you send the signed MSA?
04/06/2024, 17:32 - Me: Absolutely — I'll send the signed MSA on the 12th once our legal has countersigned
05/06/2024, 08:10 - Omar Al Mansouri: Great. We're also opening our new Sharjah branch on 20th July, would be good to be live before then
05/06/2024, 08:12 - Me: Noted, the Sharjah branch opening on 20 July is a good target to be live before
05/06/2024, 08:15 - Omar Al Mansouri: 👍
05/06/2024, 12:40 - Omar Al Mansouri: Sorry been slammed, my daughter graduates this week so it's a bit mad at home
05/06/2024, 12:41 - Me: Congratulations! No rush at all
05/06/2024, 12:42 - Omar Al Mansouri: Thanks 🙏 I'll follow up properly after Eid
05/06/2024, 12:43 - Me: Sounds good. I'll follow up after Eid to check where you landed
05/06/2024, 12:44 - Omar Al Mansouri: تمام
```

## Planted-fact map (what the extraction MUST get right — traps flagged)

| # | Planted | Expected behaviour |
|---|---|---|
| P1 | "revised quote **by Thursday**", said Mon 03/06/2024 | promise, due_date **2024-06-06**, due_raw "by Thursday" — **DATE-REF: resolves off the message date (2024), not `today` (2026)** |
| P2 | "signed MSA **on the 12th**" (said 04/06) | promise, due_date **2024-06-12**, due_raw "on the 12th" |
| P3 | "follow up **after Eid**" | promise, due_date **null**, due_raw "after Eid" — **TRAP: Eid is not resolvable; guessing a date fails** |
| T1 | "**If** Mr Rahman approves the premium tier, I can include onboarding" | **TRAP: hypothetical, NOT a promise** — must not appear in promises |
| PE1 | Omar Al Mansouri | person, decision_role **decision_maker** (he's the direct buyer/champion; roles below are defensible — see note) |
| PE2 | Yousef, "handles the technical side… he advises" | person, decision_role **influencer** |
| PE3 | Mr Rahman, "final say on budget, signs everything off" | person, decision_role **decision_maker** |
| T2 | "**Gulf Distributors** quoted us lower" | **TRAP: a competitor, not an Omar stakeholder** — must NOT be a person/deal on Omar's record |
| KD1 | "Sharjah branch opening **20th July**" | key_date, date **2024-07-20**, type opening/launch |
| PF1 | "my daughter graduates this week" | personal_fact, subject Omar, category family |
| ML | "تمام / إن شاء الله / خلاص" code-switching | handled as normal English-Arabic chat, not noise; no fabricated facts from it |

> **Note for your ruling — the one genuine judgement call (PE1/PE3):** the transcript has two
> plausible "decision_maker"s — Omar (the buyer in the room) and Mr Rahman (final budget sign-off).
> I've drafted **both** as `decision_maker` (Omar as the deal owner, Rahman as budget authority),
> Yousef as `influencer`. If you'd rather the schema force a single decision_maker, tell me and I'll
> make Omar the `champion`/`influencer` and Rahman the sole `decision_maker`. This is the only
> non-mechanical choice in the key.

## Drafted `expected: Extraction` (for certification)

```jsonc
{
  "summary": "Revised annual quote (AED 84,000) sent to Omar at ~10% under a Gulf Distributors comparison; Yousef advises on technical fit, Mr Rahman holds budget sign-off. MSA to follow; targeting live before the 20 July Sharjah branch opening.",
  "promises": [
    { "text": "Send the revised quote", "owner": "rep", "due_date": "2024-06-06", "due_raw": "by Thursday", "confidence": "high" },
    { "text": "Send the signed MSA", "owner": "rep", "due_date": "2024-06-12", "due_raw": "on the 12th", "confidence": "high" },
    { "text": "Follow up after Eid", "owner": "rep", "due_date": null, "due_raw": "after Eid", "confidence": "medium" }
  ],
  "people": [
    { "name": "Omar Al Mansouri", "role": null, "reports_to": null, "decision_role": "decision_maker", "notes": "Primary contact / buyer" },
    { "name": "Yousef", "role": "Technical", "reports_to": null, "decision_role": "influencer", "notes": "Handles the technical side; advises" },
    { "name": "Mr Rahman", "role": null, "reports_to": null, "decision_role": "decision_maker", "notes": "Final say on budget; signs off" }
  ],
  "personal_facts": [
    { "subject": "Omar Al Mansouri", "fact": "Daughter graduating this week", "category": "family" }
  ],
  "key_dates": [
    { "description": "Sharjah branch opening", "date": "2024-07-20", "date_raw": "20th July", "type": "opening" }
  ],
  "concerns": [
    { "text": "Price pressure — a competitor (Gulf Distributors) quoted lower", "severity": "medium" }
  ],
  "next_steps": [],
  "meeting": null
}
```

**Fabrication tripwires this fixture guards (a fail on any = a real regression, not a tuning target):**
P3 due_date must be `null` · T1 must not appear in promises · T2 (Gulf Distributors) must appear
NOWHERE in `people` · P1/P2 dates must be **2024**, never 2026 · daughter's graduation is a personal
fact, not a key_date/promise.
