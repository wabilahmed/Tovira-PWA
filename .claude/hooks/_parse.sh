#!/usr/bin/env bash
# Shared JSON field extractor for hooks.
#
# CRITICAL: a guard that can't parse its input must FAIL CLOSED (block), never
# fail open. A hook that silently exits 0 because `jq` is missing protects
# nothing while looking like it does.
#
# usage: FIELD=$(json_get "$INPUT" '.tool_input.file_path')
json_get() {
  local input="$1" path="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r "$path // empty" 2>/dev/null && return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    # .tool_input.file_path -> ["tool_input","file_path"]
    printf '%s' "$input" | python3 -c '
import sys, json
path = sys.argv[1].lstrip(".").split(".")
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(3)
for k in path:
    if not isinstance(d, dict) or k not in d:
        print(""); sys.exit(0)
    d = d[k]
print(d if d is not None else "")
' "$path" 2>/dev/null && return 0
  fi
  return 3   # no parser available
}

require_parser() {
  if ! command -v jq >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
    echo "[guard] BLOCKED (fail-closed): neither jq nor python3 is available to parse hook input." >&2
    echo "[guard] Install jq (brew install jq / apt install jq) — guards cannot run without it." >&2
    exit 2
  fi
}
