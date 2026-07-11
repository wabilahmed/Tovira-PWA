---
description: Run the full verification suite and report only what's broken
---

Run the complete verification pass and report **only failures**:

1. `npm run typecheck`
2. `npm test` (full suite, not a subset)
3. `npm run lint`
4. `npm run test:e2e` if it exists

For each failure, give: the test name, the story ID it belongs to (look it up in
`docs/tovira-acceptance-tests.md`), and the likely cause in one line.

If everything is green, say so in one line. Do not summarise passing tests.

Do not fix anything. This command only reports.
