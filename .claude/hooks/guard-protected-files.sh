#!/usr/bin/env bash
# guard-protected-files.sh — PreToolUse (Edit|Write|MultiEdit)
#
# Blocks the agent from editing files it must never touch:
#   1. The acceptance tests  → the agent must NEVER rewrite its own exam.
#   2. The spec/docs         → product decisions are made by humans.
#   3. Secrets               → .env and friends.
#
# Exit 2 = BLOCK (stderr is fed back to Claude). Exit 0 = allow.
# NOTE: exit 1 does NOT block — never use it here.
# FAILS CLOSED: if input can't be parsed, we block rather than wave it through.

set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_parse.sh"
require_parser

INPUT=$(cat)
FILE=$(json_get "$INPUT" '.tool_input.file_path')

# Parser blew up entirely -> fail closed.
if [[ $? -eq 3 ]]; then
  echo "[guard] BLOCKED (fail-closed): could not parse hook input." >&2
  exit 2
fi

# Genuinely no file path in this tool call -> nothing to guard.
[[ -z "$FILE" ]] && exit 0

# --- 1. The exam: acceptance tests are READ-ONLY to the agent -----------------
if [[ "$FILE" == *"tovira-acceptance-tests.md"* ]]; then
  echo "[guard] BLOCKED: tovira-acceptance-tests.md is the verification gate — READ-ONLY." >&2
  echo "[guard] You may not modify a test to make your code pass." >&2
  echo "[guard] If a test is genuinely wrong, STOP and write it to BLOCKERS.md." >&2
  exit 2
fi

# --- 2. Product decisions belong to humans -----------------------------------
if [[ "$FILE" == *"/docs/"* || "$FILE" == docs/* ]]; then
  echo "[guard] BLOCKED: docs/ holds locked product decisions (spec, plan, stories, infra)." >&2
  echo "[guard] Do not invent or amend product decisions. Use BLOCKERS.md." >&2
  exit 2
fi

# --- 3. Secrets ---------------------------------------------------------------
if [[ "$FILE" != *".env.example" ]] && \
   echo "$FILE" | grep -qE '(^|/)\.env($|\.)|secrets|credentials|\.pem$|\.key$'; then
  echo "[guard] BLOCKED: refusing to write a secrets file: $FILE" >&2
  echo "[guard] Use .env.example for templates. Never commit real secrets." >&2
  exit 2
fi

exit 0
