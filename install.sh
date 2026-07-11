#!/usr/bin/env bash
# install.sh — drop the Tovira agent harness into a repo.
#   bash install.sh /path/to/tovira-repo
set -euo pipefail
TARGET="${1:-.}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing Tovira agent harness into: $TARGET"
mkdir -p "$TARGET/.claude/hooks" "$TARGET/.claude/commands" "$TARGET/prompts" "$TARGET/docs"

cp "$SRC/.claude/settings.json"      "$TARGET/.claude/"
cp "$SRC"/.claude/hooks/*.sh         "$TARGET/.claude/hooks/"
cp "$SRC"/.claude/commands/*.md      "$TARGET/.claude/commands/"
cp "$SRC"/prompts/*.md               "$TARGET/prompts/"
[ -f "$TARGET/CLAUDE.md" ]   || cp "$SRC/CLAUDE.md"   "$TARGET/"
[ -f "$TARGET/BLOCKERS.md" ] || cp "$SRC/BLOCKERS.md" "$TARGET/"
chmod +x "$TARGET/.claude/hooks/"*.sh

if ! command -v jq >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
  echo ""
  echo "WARNING: neither jq nor python3 found. The guards will FAIL CLOSED (block everything)."
  echo "Install jq:  brew install jq   |   sudo apt install jq"
fi

echo ""
echo "Next:"
echo "  1. Copy your 6 Tovira docs into $TARGET/docs/"
echo "  2. Verify the guards:  cd $TARGET && bash .claude/hooks/test-hooks.sh"
echo "  3. Start:              claude   then  /next-story"
