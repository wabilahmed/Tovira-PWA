# Deploying Tovira

Everything below is the path from "green on `main`" to "live on a server." The
app packaging (`docker/api.prod.Dockerfile`), the manual deploy workflow
(`.github/workflows/deploy.yml`), and the CI quality gate are already in place.
The remaining work is AWS-side and is **human-gated** (it costs money): applying
the Terraform, adding secrets, and pointing DNS.

---

## What's already built

- **Infra as code** — `infra/terraform/` provisions VPC, RDS Postgres, ECS
  Fargate (one API task), ECR, S3 + CloudFront (PWA + marketing), Cognito, SES,
  the EventBridge lifecycle scheduler, Secrets Manager, IAM, and CloudWatch with
  a billing alarm. **Authored, never applied.**
- **Migrations run on boot** — the API applies `apps/api/migrations/*.sql` at
  startup (`apps/api/src/index.ts`). No separate migrate step.
- **CI** (`.github/workflows/ci.yml`) — typecheck, lint, test, build on every
  push; plus a P1-9 extraction gate that self-activates once a key exists.
- **Prod image** (`docker/api.prod.Dockerfile`) — installs all deps (the app runs
  via `tsx`, a devDependency, at runtime), runs under `tini` for clean SIGTERM.
- **Deploy workflow** (`.github/workflows/deploy.yml`) — manual trigger only,
  OIDC auth (no static keys): builds/pushes the API image, rolls the ECS service,
  and syncs the PWA to S3 + invalidates CloudFront.

---

## One-time setup

### 1. Decide the region
Default is `eu-west-1` (Ireland). The audience is **UAE field sales** — consider
`me-central-1` (UAE) or `me-south-1` (Bahrain) for latency and data residency.
Set it via the `region` Terraform variable and the `AWS_REGION` repo variable.
(Bedrock model availability differs by region — verify `EMBED_MODEL` exists there,
or keep `EMBEDDER=stub` initially.)

### 2. Bootstrap Terraform state, then apply
```bash
# Create a state bucket once (any name), then uncomment the S3 backend in
# infra/terraform/versions.tf and fill in bucket + region.
aws s3 mb s3://tovira-tfstate-<account-id> --region <region>

cd infra/terraform
terraform init
terraform plan   -var="region=<region>"
terraform apply  -var="region=<region>"
```
Note the outputs you'll need: `ecr_repository_url`, `frontend_bucket`,
`runtime_config_secret_arn`, `frontend_url`.

### 3. Close the Terraform gaps below (before or during apply)
These are needed for a working production API — see **Known Terraform gaps**.

### 4. Create the GitHub OIDC deploy role
The workflow assumes an AWS role via OIDC. There isn't one in `iam.tf` yet — add
this (adjust the repo slug / managed policies to taste), then set the repo secret
`AWS_DEPLOY_ROLE_ARN` to its ARN:
```hcl
data "aws_iam_openid_connect_provider" "github" {
  # Create once per account if absent:
  #   url = "https://token.actions.githubusercontent.com"
  #   client_id_list = ["sts.amazonaws.com"]
  arn = "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
}

resource "aws_iam_role" "github_deploy" {
  name = "tovira-${var.env}-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike   = { "token.actions.githubusercontent.com:sub" = "repo:wabilahmed/Tovira-PWA:*" }
      }
    }]
  })
}
# Grant: ECR push, ECS register-task-def + update-service, iam:PassRole for the
# task/execution roles, s3:Sync to the frontend bucket, and
# cloudfront:CreateInvalidation. Scope to the tovira-* resources.
```

### 5. Populate secrets (Secrets Manager)
Terraform seeds `tovira/<env>/app` with `REPLACE_ME` placeholders and
`ignore_changes`, so set real values without Terraform reverting them:
```bash
aws secretsmanager put-secret-value --secret-id tovira/<env>/app \
  --secret-string '{ ...full JSON... }'   # or edit in the console
```
Values to fill: `GROQ_API_KEY`, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
(`npx web-push generate-vapid-keys`), `APP_BASE_URL` (the real `https://` app
URL), and — once SES is verified — `EMAIL_SENDER=ses` + a verified `EMAIL_FROM`.
Stripe stays **test mode** (`sk_test_…`) per project policy until go-live is
explicitly approved. **Also add `ANTHROPIC_API_KEY`** (see gaps).

### 6. Set GitHub repo variables + secrets
Secrets: `AWS_DEPLOY_ROLE_ARN`, and `ANTHROPIC_API_KEY` (this one also turns on
the CI gate). Variables: `AWS_REGION`, `DEPLOY_ENV` (e.g. `prod`),
`FRONTEND_BUCKET` (= `terraform output frontend_bucket`),
`CLOUDFRONT_DISTRIBUTION_ID`.

### 7. Domain, DNS, TLS
Register/point the domain. Create **ACM certs in `us-east-1`** for the CloudFront
distributions (app + marketing), set `domain_name` / `marketing_domain` /
`marketing_acm_certificate_arn`, and add the Route 53 records. Set `APP_BASE_URL`
and Stripe success/cancel URLs to the real domain.

---

## Deploying

Actions tab → **Deploy** → Run workflow → choose `both` / `api` / `web`.
- **api**: builds `docker/api.prod.Dockerfile`, pushes to ECR, registers a new
  task revision, rolls the ECS service, waits for stability. Migrations apply on
  boot.
- **web**: builds the PWA (marketing prerendered inside it), syncs to S3, and
  invalidates CloudFront.

The workflow never runs on merge — it's manual only.

---

## Known Terraform gaps (fix before go-live — not touched here by policy)

1. **`ANTHROPIC_API_KEY` is not provisioned or injected.** `ecs.tf` sets
   `MODEL_PROVIDER=anthropic`, but the key is absent from both the secret bundle
   (`runtime-config.tf`) and the task `secrets` (`ecs.tf`). Add
   `ANTHROPIC_API_KEY` to the `secret_string`, and a matching entry to the task
   `secrets = [ … ]`. Without this the model calls fail.
2. **Several app env vars aren't injected into the task.** The secret bundle
   defines `APP_BASE_URL`, `EMAIL_SENDER`, `EMAIL_FROM`, `SES_REGION`, and
   `STRIPE_ANNUAL_PRICE_ID`, but `ecs.tf`'s `secrets` / `environment` don't pass
   them through — so emails would use the localhost default base URL, the annual
   plan wouldn't resolve, and email stays stubbed. Add them to the task.
3. **No GitHub OIDC deploy role** in `iam.tf` — add the role in step 4.
4. **`CLOUDFRONT_DISTRIBUTION_ID` isn't a Terraform output.** Add an output for
   `aws_cloudfront_distribution.frontend.id`, or read it from the console /
   `aws cloudfront list-distributions`.

## Notes

- **Stripe** is test-mode only through phase 5 (`CLAUDE.md`). Live billing needs a
  real Stripe account + business details — a product/legal step, not code.
- **The gate** (`npm run gate`) runs in CI on `main` once `ANTHROPIC_API_KEY` is
  set, and fails the build if extraction ever guesses a date, fabricates a
  promise, or merges two people.
- **First deploy**: the single ECS task runs migrations on boot; watch
  `/tovira/<env>/api` in CloudWatch for `[migrate] applied …`.
