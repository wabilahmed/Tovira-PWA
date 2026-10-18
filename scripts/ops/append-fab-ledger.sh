#!/usr/bin/env bash
# [P25-2/P26-3] Append one record (a JSONL file holding one line) to fab-ledger.jsonl on the gate-ledger
# branch, and push — with fetch + retry, never a force-push. Used by the CI gate job for its "started"
# record (before any model call) and its result record (whatever the verdict).
#   scripts/ops/append-fab-ledger.sh <record.jsonl> <commit message>
set -euo pipefail
RECORD="${1:?record file}"
MESSAGE="${2:?commit message}"
LEDGER_DIR="${LEDGER_DIR:-${RUNNER_TEMP:-/tmp}/gate-ledger}"
[ -s "$RECORD" ] || { echo "append-fab-ledger: $RECORD is empty — nothing to append" >&2; exit 1; }
[ "$(wc -l < "$RECORD" | tr -d ' ')" = "1" ] || { echo "append-fab-ledger: $RECORD must hold exactly one line" >&2; exit 1; }
# The bot identity is passed per command (git -c) — never written to any git config.
BOT=(-c "user.name=github-actions[bot]" -c "user.email=41898282+github-actions[bot]@users.noreply.github.com")
for attempt in 1 2 3 4 5; do
  git worktree remove --force "$LEDGER_DIR" 2>/dev/null || rm -rf "$LEDGER_DIR"
  git fetch --no-tags origin gate-ledger
  git worktree add --detach "$LEDGER_DIR" FETCH_HEAD
  cat "$RECORD" >> "$LEDGER_DIR/fab-ledger.jsonl"
  git -C "$LEDGER_DIR" add fab-ledger.jsonl
  git "${BOT[@]}" -C "$LEDGER_DIR" commit -q -m "$MESSAGE"
  if git -C "$LEDGER_DIR" push origin HEAD:gate-ledger; then
    git worktree remove --force "$LEDGER_DIR" || true
    exit 0
  fi
  sleep $((attempt * 5))
done
echo "append-fab-ledger: could not append after 5 attempts" >&2
exit 1
