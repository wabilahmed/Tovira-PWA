# Making a missing ANTHROPIC_API_KEY a hard CI failure (report only — not implemented)

## Today's behaviour (the dark-skip)

`ci.yml` gate step (`ci.yml:47-52`):

```sh
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "No ANTHROPIC_API_KEY secret set — skipping the P1-9 gate."
  exit 0            # ← GREEN SKIP: the job succeeds without running the gate
fi
npm run gate
```

The gate job `needs: verify`, runs `if: github.ref == 'refs/heads/main'`. Deploy is chained on the
**CI workflow's overall success** (`deploy.yml` `workflow_run … conclusion == 'success'`). So a green
skip → CI success → **Deploy proceeds with the gate never having run.** That is "a metric that ships
dark": the check reports green whether or not it actually validated anything.

## The minimal change

One line: `exit 0` → `exit 1`, with a clear message:

```sh
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "::error::ANTHROPIC_API_KEY is not set — the P1-9 gate cannot run. Refusing to pass a dark gate."
  exit 1
fi
```

Effect: any push to `main` without the secret **fails CI → no deploy**. The gate can no longer be
green without running.

## What that actually commits you to (the tradeoffs — this is the real decision)

1. **ANTHROPIC_API_KEY becomes a hard prerequisite for every `main` deploy, forever.** If the key is
   rotated, removed, or expires, `main` stops deploying until it's restored. That is the point — but
   it couples *all* shipping (docs, infra, unrelated features) to the key's presence, not just
   extraction changes.
2. **Deployability becomes coupled to Anthropic account health.** If the key is present but credits are
   exhausted, `npm run gate` fails at the first API call → CI fails → no deploy. Arguably correct
   ("don't ship if you can't validate extraction"), but note the credit outage that blocked THIS whole
   session would then have blocked *every* deploy, not just the `[skip ci]` ones. That coupling is
   exactly what the self-skip was designed to avoid early on. Deciding to hard-fail is deciding that
   coupling is now acceptable.
3. **Two distinct failure reasons should read differently** so an operator isn't misled:
   - *key missing* → a config error ("gate cannot run"), fix = add the secret;
   - *gate ran and failed* → a real regression (fabrication/guessed date/merge/receipt), fix = the code.
   Both must block deploy; the messages should not be conflated.
4. **PRs/forks are unaffected** — the gate is `main`-only, and forks never see the secret. So a hard
   fail does not break contributor PRs. (If the gate were ever made to run on PRs, forks would need an
   explicit exemption.)

## A more surgical option (scopes the hard requirement to changes that need it)

Hard-fail **only when extraction-affecting files changed**, else allow the skip. In the gate step,
diff the push range for the prompt / scorer / eval set / extraction service:

```sh
CHANGED=$(git diff --name-only ${{ github.event.before }} ${{ github.sha }})
NEEDS_GATE=$(echo "$CHANGED" | grep -E 'services/extraction/prompt|eval/(score|eval-set)|services/extraction/extraction-service' || true)
if [ -z "$ANTHROPIC_API_KEY" ]; then
  if [ -n "$NEEDS_GATE" ]; then echo "::error::extraction changed but no key — gate cannot run"; exit 1; fi
  echo "No key and no extraction change — skipping."; exit 0
fi
npm run gate
```

Cost: more workflow logic (and `github.event.before` is unreliable on force-push/first-push, so it
needs a fallback to a full-fail). Benefit: unrelated deploys aren't blocked by a missing key, while any
change that could move the gated metrics can't ship dark.

## Guard against silent reversion (meta)

Whichever option, add a one-line assertion that the workflow still contains the hard-fail (a text check
over `ci.yml`, alongside the existing wiring-guard style) so nobody quietly restores `exit 0`. Without
it, the protection itself can regress dark.

## Recommendation (for your call — not implemented)

The **minimal `exit 1`** is the honest default and matches "a gate that silently doesn't run is the
same defect class as a metric that ships dark." Its one real cost is coupling all deploys to key/credit
health. If that coupling is unwanted, the **surgical path-scoped** version keeps the guarantee where it
matters (extraction changes) without blocking unrelated ships. Either is a few lines in `ci.yml`; say
which and I'll implement it as its own commit. Not touched in this task.
