#!/usr/bin/env bash
# check-ci-skip-token.sh — refuse the "[skip ci] trap".
#
# GitHub scans the ENTIRE commit message (subject + body) for a CI-skip token —
# [skip ci] [ci skip] [no ci] [skip actions] [actions skip] ***NO_CI*** — and
# silently skips the workflow run when it finds one. Commit d133d9d was meant to
# TRIGGER CI but its body quoted "[skip ci]" while describing other commits, so
# GitHub skipped it and no CI ran.
#
# Intent rule: a commit whose SUBJECT carries a skip token is deliberately
# skipping CI (allowed). A commit whose subject does NOT carry one is intended to
# run CI — so a skip token hiding in its BODY is always a mistake. Block exactly
# that: token in the body, absent from the subject.
#
# Usage: check-ci-skip-token.sh <commit-msg-file>   (exit 0 = ok, exit 1 = block)
set -uo pipefail

MSG_FILE="${1:?usage: check-ci-skip-token.sh <commit-msg-file>}"
[ -f "$MSG_FILE" ] || { echo "[ci-skip-guard] no such message file: $MSG_FILE" >&2; exit 1; }

# Drop git's comment lines (the commit template) before inspecting.
MSG="$(grep -v '^#' "$MSG_FILE" || true)"
# Subject = first non-blank line; body = everything after it.
SUBJECT="$(printf '%s\n' "$MSG" | sed '/^[[:space:]]*$/d' | head -n 1)"
BODY="$(printf '%s\n' "$MSG" | sed '/^[[:space:]]*$/d' | tail -n +2)"

TOKENS='\[skip ci\]|\[ci skip\]|\[no ci\]|\[skip actions\]|\[actions skip\]|\*\*\*NO_CI\*\*\*'

subject_has_token() { printf '%s' "$SUBJECT" | grep -qiE "$TOKENS"; }
body_has_token()    { printf '%s' "$BODY"    | grep -qiE "$TOKENS"; }

if body_has_token && ! subject_has_token; then
  echo "[ci-skip-guard] BLOCKED: a CI-skip token appears in the commit BODY but not the SUBJECT." >&2
  echo "[ci-skip-guard] GitHub scans the WHOLE message and will SKIP CI for this commit (the d133d9d trap)." >&2
  echo "[ci-skip-guard]   • If you MEANT to skip CI  -> put the token in the SUBJECT line." >&2
  echo "[ci-skip-guard]   • If this should TRIGGER CI -> rephrase the body (e.g. 'skip-ci', 'the CI-skip marker')." >&2
  exit 1
fi
exit 0
