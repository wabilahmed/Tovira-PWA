#!/usr/bin/env bash
# Verify, then commit. Nothing is committed unless EVERY step exits 0.
#
#   scripts/verify-commit.sh "<message>" <file>...
#
# Each step's OWN exit status decides. Its output goes to a log file and is never piped into grep/tail before the
# decision, and pipefail is on, so a failing test can never hide behind another command's success (the P69-12 slip:
# `npx playwright test | grep … | tail && commit` committed on two failing tests because tail exited 0).
#
# Steps: typecheck, lint, the full unit suite, Playwright. VERIFY_STEPS (one command per line) replaces them, for the
# script's own test. VERIFY_DRY_RUN=1 prints "WOULD COMMIT" instead of committing. VERIFY_TRAILER is appended to the
# commit message (e.g. Co-Authored-By lines).
set -euo pipefail

if [ "$#" -lt 2 ]; then echo "usage: $0 \"<message>\" <file>..." >&2; exit 2; fi
msg="$1"; shift

DEFAULT_STEPS=$'npm run typecheck\nnpm run lint\nnpm test\nnpx playwright test'
steps="${VERIFY_STEPS:-$DEFAULT_STEPS}"
logdir="$(mktemp -d)"

i=0
while IFS= read -r step; do
  [ -z "$step" ] && continue
  i=$((i + 1))
  log="$logdir/step-$i.log"
  echo "verify: $step"
  status=0
  bash -o pipefail -c "$step" >"$log" 2>&1 || status=$?
  if [ "$status" -ne 0 ]; then
    tail -n 40 "$log" >&2 || true
    echo "VERIFY FAILED (exit $status): $step. Nothing committed." >&2
    exit 1
  fi
done <<< "$steps"

if [ "${VERIFY_DRY_RUN:-0}" = "1" ]; then echo "WOULD COMMIT: $msg"; exit 0; fi
git add -- "$@"
if [ -n "${VERIFY_TRAILER:-}" ]; then git commit -q -m "$msg" -m "$VERIFY_TRAILER"; else git commit -q -m "$msg"; fi
git log --oneline -1
