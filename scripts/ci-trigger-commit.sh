#!/usr/bin/env bash
# ci-trigger-commit.sh — make a CI-trigger commit that CANNOT be silently skipped.
#
# A trigger commit exists to RUN CI, so its message must contain NO CI-skip token
# anywhere (subject or body) — stricter than the commit-msg hook, which only blocks
# the body-not-subject case for ordinary commits. This is the safe path even under
# `git commit --no-verify` (it IS the commit tool, so nothing is bypassed).
#
# Usage: scripts/ci-trigger-commit.sh "<subject>" ["<body...>"]
set -uo pipefail

SUBJECT="${1:?usage: ci-trigger-commit.sh \"<subject>\" [\"<body>\"]}"
shift || true
BODY="${*:-}"

TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
{
  printf '%s\n' "$SUBJECT"
  if [ -n "$BODY" ]; then printf '\n%s\n' "$BODY"; fi
} > "$TMP"

TOKENS='\[skip ci\]|\[ci skip\]|\[no ci\]|\[skip actions\]|\[actions skip\]|\*\*\*NO_CI\*\*\*'
if grep -qiE "$TOKENS" "$TMP"; then
  echo "[ci-trigger] REFUSED: a trigger commit must contain NO CI-skip token anywhere." >&2
  echo "[ci-trigger] GitHub scans the whole message and would SKIP the run. Rephrase (e.g. 'skip-ci')." >&2
  exit 1
fi

git commit --allow-empty -F "$TMP"
