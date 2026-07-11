#!/usr/bin/env bash
# test-hooks.sh — verify the guards actually block.
#
# RUN THIS AFTER INSTALL, and again on any machine that runs the agent.
# A guard that silently fails OPEN is worse than no guard at all — it looks
# like protection while protecting nothing. (Classic cause: `jq` not installed.)
#
#   bash .claude/hooks/test-hooks.sh

cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1
H=".claude/hooks"
PASS=0; FAIL=0

t() {
  local name="$1" json="$2" hook="$3" want="$4"
  echo "$json" | bash "$H/$hook" >/dev/null 2>&1; local got=$?
  if [ "$got" = "$want" ]; then printf '  \033[32mPASS\033[0m  %s\n' "$name"; PASS=$((PASS+1))
  else printf '  \033[31mFAIL\033[0m  %s  (exit %s, expected %s)\n' "$name" "$got" "$want"; FAIL=$((FAIL+1)); fi
}

echo "Protected files (2 = blocked, 0 = allowed)"
t "BLOCK  edit acceptance tests" '{"tool_input":{"file_path":"docs/tovira-acceptance-tests.md"}}' guard-protected-files.sh 2
t "BLOCK  edit spec"             '{"tool_input":{"file_path":"docs/tovira-spec.md"}}'             guard-protected-files.sh 2
t "BLOCK  write .env"            '{"tool_input":{"file_path":".env"}}'                            guard-protected-files.sh 2
t "BLOCK  write private.key"     '{"tool_input":{"file_path":"certs/private.key"}}'               guard-protected-files.sh 2
t "ALLOW  .env.example"          '{"tool_input":{"file_path":".env.example"}}'                    guard-protected-files.sh 0
t "ALLOW  source file"           '{"tool_input":{"file_path":"src/extract.ts"}}'                  guard-protected-files.sh 0
t "ALLOW  test file"             '{"tool_input":{"file_path":"tests/extract.test.ts"}}'           guard-protected-files.sh 0
t "ALLOW  BLOCKERS.md"           '{"tool_input":{"file_path":"BLOCKERS.md"}}'                     guard-protected-files.sh 0

echo "Bash guard"
t "BLOCK  aws cli"               '{"tool_input":{"command":"aws s3 ls"}}'                          guard-bash.sh 2
t "BLOCK  terraform apply"       '{"tool_input":{"command":"terraform apply -auto-approve"}}'      guard-bash.sh 2
t "BLOCK  cdk deploy"            '{"tool_input":{"command":"cdk deploy --all"}}'                   guard-bash.sh 2
t "BLOCK  stripe live key"       '{"tool_input":{"command":"export K=sk_live_abc"}}'               guard-bash.sh 2
t "BLOCK  force push"            '{"tool_input":{"command":"git push --force origin main"}}'       guard-bash.sh 2
t "BLOCK  DROP TABLE"            '{"tool_input":{"command":"psql -c \"DROP TABLE clients\""}}'     guard-bash.sh 2
t "BLOCK  rm -rf /"              '{"tool_input":{"command":"rm -rf /"}}'                           guard-bash.sh 2
t "BLOCK  sed the tests file"    '{"tool_input":{"command":"sed -i s/a/b/ docs/tovira-acceptance-tests.md"}}' guard-bash.sh 2
t "ALLOW  npm test"              '{"tool_input":{"command":"npm test"}}'                           guard-bash.sh 0
t "ALLOW  docker compose up"     '{"tool_input":{"command":"docker compose up -d"}}'               guard-bash.sh 0
t "ALLOW  git commit"            '{"tool_input":{"command":"git commit -m feat"}}'                 guard-bash.sh 0
t "ALLOW  git push (normal)"     '{"tool_input":{"command":"git push origin feature/x"}}'          guard-bash.sh 0
t "ALLOW  stripe TEST key"       '{"tool_input":{"command":"export K=sk_test_abc"}}'               guard-bash.sh 0
t "ALLOW  rm -rf node_modules"   '{"tool_input":{"command":"rm -rf node_modules"}}'                guard-bash.sh 0

echo ""
if [ "$FAIL" -gt 0 ]; then
  printf '\033[31m%s passed, %s FAILED — your guards are not protecting you. Do not run unattended.\033[0m\n' "$PASS" "$FAIL"
  echo "Most likely cause: jq is not installed. Install it: brew install jq  /  apt install jq"
  exit 1
fi
printf '\033[32mAll %s guard tests passed.\033[0m\n' "$PASS"
