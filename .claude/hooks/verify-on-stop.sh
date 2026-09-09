#!/usr/bin/env bash
# verify-on-stop.sh — Stop hook
#
# THE VERIFICATION GATE. This is the thing that makes unattended runs safe.
#
# When Claude thinks it's finished, this runs the full suite + typecheck.
# If anything is red, we exit 2 — which FORCES Claude to keep working instead
# of declaring victory on a broken build. The agent cannot skip this: it's
# plain code run by the harness, not a request the model can decide to ignore.
#
# Exit 2 = "you are not done, keep going" (stderr is fed back as the reason).
# Exit 0 = genuinely done.

set -uo pipefail

INPUT=$(cat)

# Guard against infinite loops: if we're already inside a stop-hook retry,
# don't re-trigger endlessly. Claude Code sets stop_hook_active for this.
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false')
if [[ "$ACTIVE" == "true" ]]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# If the project isn't scaffolded yet (Phase 0 in progress), don't block.
[[ -f package.json ]] || exit 0

# [GATE-RUN GUARD] Don't verify while a certification / gate run is active. Its hundreds of live model
# calls starve the machine and time-out timing-sensitive tests (e.g. inventory-share, share-referral) —
# a false red. A hook that cries wolf during long runs gets learned-ignored, which is the same tripwire
# decay we fought with the per-run fabrication bar. A gate run is the agent's deliberate long task; the
# next stop after it finishes verifies for real. (Detects the gate script directly — no lock to leak.)
if pgrep -f "tsx src/eval/index.ts" >/dev/null 2>&1; then
  echo "[verify] a gate/certification run is active (eval/index.ts) — skipping verification until it finishes." >&2
  exit 0
fi

FAILED=""

echo "[verify] running typecheck..." >&2
if ! npm run typecheck --silent >/tmp/tovira-typecheck.log 2>&1; then
  FAILED="${FAILED}\n--- TYPECHECK FAILED ---\n$(tail -30 /tmp/tovira-typecheck.log)"
fi

echo "[verify] running test suite..." >&2
if ! npm test --silent >/tmp/tovira-test.log 2>&1; then
  FAILED="${FAILED}\n--- TESTS FAILED ---\n$(tail -40 /tmp/tovira-test.log)"
fi

echo "[verify] running lint..." >&2
if ! npm run lint --silent >/tmp/tovira-lint.log 2>&1; then
  FAILED="${FAILED}\n--- LINT FAILED ---\n$(tail -20 /tmp/tovira-lint.log)"
fi

if [[ -n "$FAILED" ]]; then
  {
    echo "[verify] YOU ARE NOT DONE. The build is red."
    echo -e "$FAILED"
    echo ""
    echo "[verify] Fix the failures. Rules:"
    echo "  - Do NOT weaken, skip, or delete a test to make it pass."
    echo "  - Do NOT mark the story complete while anything is red."
    echo "  - If a test looks genuinely wrong, STOP and write it to BLOCKERS.md."
  } >&2
  exit 2
fi

echo "[verify] green: typecheck + tests + lint all pass." >&2
exit 0
