#!/usr/bin/env bash
# One-time bootstrap for automated provisioning. Run LOCALLY once, with AWS admin
# credentials. Idempotent — safe to re-run. It creates the pieces Terraform and
# the GitHub workflows can't create for themselves:
#   1. an S3 bucket for Terraform remote state (versioned + encrypted + locked down)
#   2. a GitHub OIDC provider (if absent)
#   3. two IAM roles GitHub Actions assume via OIDC — a broad "provision" role
#      (terraform apply) and a narrower "deploy" role (build/push/roll the app)
# After this, provisioning + deploys run entirely from the GitHub Actions tab.
#
# Review before running — it creates IAM roles. Nothing here is a Tovira secret.
set -euo pipefail

REGION="${AWS_REGION:-eu-north-1}"
ENV="${ENV:-prod}"
REPO="${GITHUB_REPO:-wabilahmed/Tovira-PWA}"       # owner/name
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
STATE_BUCKET="${TF_STATE_BUCKET:-tovira-tfstate-${ACCOUNT_ID}}"
OIDC_HOST="token.actions.githubusercontent.com"
OIDC_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/${OIDC_HOST}"

echo "account=${ACCOUNT_ID} region=${REGION} env=${ENV} repo=${REPO}"

# 1) Terraform state bucket ---------------------------------------------------
if aws s3api head-bucket --bucket "$STATE_BUCKET" 2>/dev/null; then
  echo "state bucket exists: $STATE_BUCKET"
else
  echo "creating state bucket: $STATE_BUCKET"
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$STATE_BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$STATE_BUCKET" --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION"
  fi
fi
aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$STATE_BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket "$STATE_BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# 2) GitHub OIDC provider -----------------------------------------------------
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  echo "OIDC provider exists"
else
  echo "creating GitHub OIDC provider"
  aws iam create-open-id-connect-provider --url "https://${OIDC_HOST}" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1"
fi

# Trust policy: only this repo's workflows may assume the roles.
trust() {
  cat <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
"Principal":{"Federated":"${OIDC_ARN}"},
"Action":"sts:AssumeRoleWithWebIdentity",
"Condition":{"StringEquals":{"${OIDC_HOST}:aud":"sts.amazonaws.com"},
"StringLike":{"${OIDC_HOST}:sub":"repo:${REPO}:*"}}}]}
JSON
}

make_role() {
  local name="$1" policy_arn="$2"
  if aws iam get-role --role-name "$name" >/dev/null 2>&1; then
    aws iam update-assume-role-policy --role-name "$name" --policy-document "$(trust)"
    echo "role updated: $name"
  else
    aws iam create-role --role-name "$name" --assume-role-policy-document "$(trust)" >/dev/null
    echo "role created: $name"
  fi
  aws iam attach-role-policy --role-name "$name" --policy-arn "$policy_arn" || true
}

# 3) The two roles. PROVISION is broad (terraform apply touches VPC/RDS/ECS/IAM/…);
#    scope it down later with a customer-managed policy. DEPLOY is a scoped inline
#    policy (ECR push, ECS roll, S3 sync, CloudFront invalidate, PassRole).
make_role "tovira-${ENV}-provision" "arn:aws:iam::aws:policy/AdministratorAccess"

make_role "tovira-${ENV}-deploy" "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser"
aws iam put-role-policy --role-name "tovira-${ENV}-deploy" --policy-name "deploy-extra" \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
 {\"Effect\":\"Allow\",\"Action\":[\"ecs:DescribeServices\",\"ecs:DescribeTaskDefinition\",\"ecs:RegisterTaskDefinition\",\"ecs:UpdateService\",\"ecs:DescribeTasks\",\"ecs:ListTasks\"],\"Resource\":\"*\"},
 {\"Effect\":\"Allow\",\"Action\":[\"s3:ListBucket\",\"s3:PutObject\",\"s3:DeleteObject\",\"s3:GetObject\"],\"Resource\":[\"arn:aws:s3:::tovira-${ENV}-web-${ACCOUNT_ID}\",\"arn:aws:s3:::tovira-${ENV}-web-${ACCOUNT_ID}/*\"]},
 {\"Effect\":\"Allow\",\"Action\":[\"cloudfront:CreateInvalidation\"],\"Resource\":\"*\"},
 {\"Effect\":\"Allow\",\"Action\":[\"iam:PassRole\"],\"Resource\":\"arn:aws:iam::${ACCOUNT_ID}:role/tovira-${ENV}-*\"}
]}"

cat <<OUT

──────────────────────────────────────────────────────────────────────────────
Bootstrap complete. Set these in GitHub → Settings → Secrets and variables → Actions:

  Secrets:
    AWS_PROVISION_ROLE_ARN = arn:aws:iam::${ACCOUNT_ID}:role/tovira-${ENV}-provision
    AWS_DEPLOY_ROLE_ARN    = arn:aws:iam::${ACCOUNT_ID}:role/tovira-${ENV}-deploy
    ANTHROPIC_API_KEY      = <your rotated key>          # also enables the CI gate
  Variables:
    AWS_REGION                 = ${REGION}
    DEPLOY_ENV                 = ${ENV}
    TF_STATE_BUCKET            = ${STATE_BUCKET}
    FRONTEND_BUCKET            = tovira-${ENV}-web-${ACCOUNT_ID}
    CLOUDFRONT_DISTRIBUTION_ID = <from 'terraform output' after the first apply>
    SMOKE_URL                  = <your https app URL, once DNS is live>

Next: run the "Provision" workflow (apply) → load secrets (scripts/set-secrets.sh)
→ run the "Deploy" workflow. See DEPLOY.md → Automated provisioning.
──────────────────────────────────────────────────────────────────────────────
OUT
