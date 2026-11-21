# Tovira accuracy test: 2,000-message chat

**Files**
- `WhatsApp Chat - Layla Haddad.zip`: an iPhone-format export (`_chat.txt`), 2,000 messages, 1 Mar to 15 Nov 2026. Client: Layla Haddad. Rep: Sam Karimi. All people, numbers and IDs are fictional.
- `answer-key.csv`: every planted item, with its message number, the expected field and value, the expected date, and notes.

**What's planted:** 18 obvious, 20 moderate and 16 obscure items, plus 12 traps. Everything else is content-free chatter (ok, thanks, emoji, images omitted, listing links).

**By field (excluding traps):** concerns 6, key_dates 8, meeting 2, next_steps 3, people 1, personal_facts 9, promises 9, requirements 16.

**Difficulty**
- **Obvious:** a single, direct statement.
- **Moderate:** buried at the end of a chatty message, split across two messages, a relative or year-less date, conditional, or a third party's need.
- **Obscure:** implied by a complaint or a joke, written in Arabizi, three promises in one message, a correction months later, a pet you only know from context, an inferred date.

**Traps (precision):** health (x2), religion, an Emirates ID number, the rep's own fact, a vague "someday", an unnamed colleague, an ambiguous numeric date, sarcasm about the budget, and a pregnancy. Rows marked `must_not_store = YES` must not appear in any field.

**Scoring rules**
1. **Recall:** an item counts as found if its meaning is stored in the expected field (or in an equally valid field, e.g. a requirement noted as a personal fact). Report it by difficulty and by field.
2. **Dates:** `expected_date` is what should be stored. An empty `expected_date` with a `date_raw` means the date must stay null.
3. **Updates:** the latest value wins (X01 replaces O02; M19 updates O01; O18 is the meeting kept, not O06).
4. **Precision:** any stored detail that isn't in the key and isn't supported by the chat counts as invented. Any trap violation is a hard fail.
5. **The chatter** should produce nothing.

**Before using it:** Wabil reviews and approves the key (the agent drafts, the owner certifies).
