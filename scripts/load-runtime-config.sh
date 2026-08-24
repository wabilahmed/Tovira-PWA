#!/usr/bin/env bash
# Load real runtime values into AWS Secrets Manager (tovira/<env>/app) WITHOUT
# ever committing them. Reads a local, git-ignored env file (KEY=VALUE lines),
# merges those keys into the existing secret (so Terraform-managed DATABASE_URL
# etc. are preserved), and puts the new version back. Requires: aws, jq.
#
#   cp .env.prod.example .env.prod   # then fill in the real values
#   ENV=prod AWS_REGION=eu-north-1 scripts/load-runtime-config.sh .env.prod
set -euo pipefail

ENV="${ENV:-prod}"
REGION="${AWS_REGION:-eu-north-1}"
FILE="${1:-.env.prod}"
SECRET_ID="tovira/${ENV}/app"

[ -f "$FILE" ] || { echo "no env file: $FILE (copy .env.prod.example → $FILE and fill it in)"; exit 1; }
command -v jq >/dev/null || { echo "jq is required (brew install jq)"; exit 1; }

# Only these externally-supplied keys are pushed; everything else in the file is
# ignored. DATABASE_URL/APP_DATABASE_URL/APP_DB_PASSWORD stay Terraform-managed.
ALLOWED="ANTHROPIC_API_KEY GROQ_API_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_PRICE_ID STRIPE_ANNUAL_PRICE_ID EMAIL_SENDER EMAIL_FROM SES_REGION APP_BASE_URL"

current="$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --region "$REGION" --query SecretString --output text 2>/dev/null || echo '{}')"
merged="$current"
while IFS='=' read -r key val; do
  case "$key" in ''|\#*) continue;; esac
  for a in $ALLOWED; do
    if [ "$key" = "$a" ]; then
      merged="$(printf '%s' "$merged" | jq --arg k "$key" --arg v "$val" '.[$k]=$v')"
      echo "  set $key"
    fi
  done
done < "$FILE"

aws secretsmanager put-secret-value --secret-id "$SECRET_ID" --region "$REGION" \
  --secret-string "$merged" >/dev/null
echo "runtime config updated in $SECRET_ID"
