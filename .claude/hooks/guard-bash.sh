#!/usr/bin/env bash
# guard-bash.sh — PreToolUse (Bash)
#
# Phases 0–5 are LOCAL ONLY. The agent must never touch cloud, money, or
# anything irreversible.
#
# Exit 2 = BLOCK. Exit 0 = allow. (exit 1 does NOT block — never use it.)
# FAILS CLOSED on unparseable input.

set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_parse.sh"
require_parser

INPUT=$(cat)
CMD=$(json_get "$INPUT" '.tool_input.command')

if [[ $? -eq 3 ]]; then
  echo "[guard-bash] BLOCKED (fail-closed): could not parse hook input." >&2
  exit 2
fi

[[ -z "$CMD" ]] && exit 0

block() {
  echo "[guard-bash] BLOCKED: $1" >&2
  echo "[guard-bash] Command was: $CMD" >&2
  echo "[guard-bash] Phases 0-5 are LOCAL ONLY. Cloud and money are human-gated." >&2
  exit 2
}

# --- Cloud / spend ------------------------------------------------------------
echo "$CMD" | grep -qE '(^|[;&|[:space:]])aws[[:space:]]'                        && block "AWS CLI is human-gated (costs money)."
echo "$CMD" | grep -qE '(^|[;&|[:space:]])(terraform|pulumi|cdk|sam)[[:space:]]+(apply|deploy|destroy|up)' && block "Infra provisioning is human-gated."
echo "$CMD" | grep -qE 'sk_live_|rk_live_'                                       && block "Stripe LIVE key. Test mode only (sk_test_)."
echo "$CMD" | grep -qE 'stripe[[:space:]].*--live'                               && block "Stripe live mode is human-gated."
echo "$CMD" | grep -qE 'AKIA[0-9A-Z]{16}'                                        && block "Looks like a real AWS access key."

# --- Destructive git ----------------------------------------------------------
echo "$CMD" | grep -qE 'git[[:space:]]+push.*(--force|-f([[:space:]]|$))'        && block "Force-push is not allowed."
echo "$CMD" | grep -qE 'git[[:space:]]+reset[[:space:]]+--hard[[:space:]]+origin' && block "Hard reset to origin discards work."
echo "$CMD" | grep -qE 'git[[:space:]]+clean[[:space:]]+-[a-z]*f[a-z]*d'          && block "git clean -fd destroys untracked files."

# --- Destructive filesystem / DB ---------------------------------------------
echo "$CMD" | grep -qE 'rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*[[:space:]]+(/|~|\$HOME)([[:space:]]|$)' && block "Recursive delete of a root/home path."
echo "$CMD" | grep -qE 'rm[[:space:]]+-[a-zA-Z]*f[a-zA-Z]*r?[[:space:]]+/([[:space:]]|$)'          && block "Recursive delete of /."
echo "$CMD" | grep -qiE 'DROP[[:space:]]+(TABLE|DATABASE)|TRUNCATE[[:space:]]+TABLE' && block "Destructive SQL. Use a migration."

# --- The exam: never let the shell rewrite the tests ---------------------------
echo "$CMD" | grep -qE '(>|>>|tee|sed[[:space:]]+-i|mv|cp|rm).*tovira-acceptance-tests\.md' && block "Refusing to modify the acceptance-tests file via shell."

exit 0
