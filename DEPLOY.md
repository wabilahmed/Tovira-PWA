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
- **Deploy workflow** (`.github/workflows/deploy.yml`) — **auto-deploys after CI
  passes on `main`** (chained via `workflow_run`; a red suite never deploys), and
  is still manually runnable from the Actions tab (target `api` / `web` / `both`).
  OIDC auth (no static keys): builds/pushes the API image, rolls the ECS service,
  and syncs the PWA to S3 + invalidates CloudFront. Image tag + checkout are pinned
  to the exact commit CI verified.

---

## Automated provisioning (one bootstrap, then buttons)

Drive the whole setup from one local bootstrap + two GitHub workflows — no clicking
around the console. (The manual steps below are the under-the-hood detail.)

The Terraform is complete (see *Terraform status — gaps closed*), so provisioning
stands up a working stack. You supply only real secret values and DNS.

1. **Bootstrap once** (local, AWS admin creds; idempotent — creates the state bucket
   + the two OIDC roles):
   ```bash
   ENV=prod AWS_REGION=eu-north-1 GITHUB_REPO=wabilahmed/Tovira-PWA \
     bash scripts/aws-bootstrap.sh          # or: make bootstrap
   ```
   It prints the exact GitHub **secrets** (`AWS_PROVISION_ROLE_ARN`,
   `AWS_DEPLOY_ROLE_ARN`, `ANTHROPIC_API_KEY`) and **variables** (`AWS_REGION`,
   `DEPLOY_ENV`, `TF_STATE_BUCKET`, `FRONTEND_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`,
   `SMOKE_URL`) to set in *Settings → Secrets and variables → Actions*.

2. **Provision the infra** — run the **Provision (Terraform)** workflow: `plan`
   first (review the diff), then `apply` (via OIDC; S3 remote state is configured at
   runtime). Gate `apply` by protecting a `production` environment with a required
   reviewer. The first apply uses a placeholder image; step 4 makes it real.
   ```bash
   make provision-plan     # review, then:
   make provision-apply
   ```
   Copy `FRONTEND_BUCKET` + the CloudFront distribution id into the repo variables.

3. **Load runtime config** into Secrets Manager (never committed):
   ```bash
   cp .env.example .env.prod   # fill in the real values (.env.prod is git-ignored)
   make config                 # → scripts/load-runtime-config.sh
   ```

4. **Deploy the app** — run the **Deploy** workflow (`make deploy`): builds + pushes
   the API image, rolls the ECS service (migrations on boot), ships the PWA, and
   smoke-tests `/api/health`.

5. **DNS/TLS** — point the domain at CloudFront and issue the ACM cert in `us-east-1`.
   With the domain in Route 53, Terraform can automate the cert + validation records;
   otherwise validate once by hand.

After the one bootstrap, provisioning and deploys are two buttons in the Actions tab.
Fully managed alternative: connect the repo to **HCP Terraform** (remote state +
plan/apply on merge with a UI approval) in place of the Provision workflow.

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

## Terraform status — gaps closed

The blockers found in the pre-launch audit are now **fixed in `infra/terraform/`**
(`terraform validate` passes). What changed:

- **[RESOLVED] CloudFront now routes the API.** `storage.tf` adds the ALB as a
  second origin and a `/api/*` behavior (uncached, all methods, cookies + auth
  forwarded). The distribution-wide `custom_error_response` was removed (it would
  rewrite legitimate API 4xx into the app shell); the SPA fallback moved into the
  `frontend_dir_index` CloudFront function (`marketing.tf`) — static files pass,
  marketing pages get their index, every other dotless path serves `/app.html`.
- **[RESOLVED] Model key + missing env.** `ANTHROPIC_API_KEY` is added to the
  secret bundle (`runtime-config.tf`) and, with `STRIPE_ANNUAL_PRICE_ID`,
  `APP_BASE_URL`, `EMAIL_SENDER`, `EMAIL_FROM`, `SES_REGION`, injected into the
  task (`ecs.tf`).
- **[RESOLVED] Distribution id output** (`outputs.tf` → `cloudfront_distribution_id`).
- **[RESOLVED] OIDC deploy role** — created by `scripts/aws-bootstrap.sh` (not TF).
- **[RESOLVED] Autoscaling + zero-downtime deploys** — `autoscaling.tf`
  (target-tracking, min 1 / max 6) + `deployment_circuit_breaker` and
  `health_check_grace_period_seconds` on the ECS service; `desired_count` is now
  ignored so Terraform and autoscaling don't fight.
- **[RESOLVED] Security response headers** — a CloudFront response-headers policy
  (HSTS, nosniff, `frame-options DENY`, referrer policy) on both behaviors.
- **Region** defaults to `eu-north-1` (Stockholm).

Two follow-ups remain (both noted below, neither a blocker):
- Point Stripe's webhook at `https://<domain>/api/billing/webhook`.
- CloudFront→ALB is HTTP over the internet — for hardening, lock the ALB security
  group to CloudFront's managed prefix list + a shared-secret origin header, or add
  a 443 listener with ACM.

## Cost & scaling — cheapest 10-user setup (Stockholm)

The existing architecture (Fargate + ALB + CloudFront + RDS) is already the
cheapest *sensible* managed design, and it scales horizontally with **zero
downtime** — keep it. Don't drop the ALB for a single EC2: that would be ~$20/mo
cheaper but can't do no-downtime rolling deploys or horizontal scale.

**Region → Stockholm** (`infra/terraform/variables.tf`):
- `region` default → `"eu-north-1"`
- `azs` default → `["eu-north-1a", "eu-north-1b"]`

**Approx cost, ~10 users, on-demand USD/mo** (Stockholm is one of the cheapest
regions):

| Component | ~Cost |
| --- | --- |
| Fargate 0.25 vCPU + 0.5 GB (ARM, 24×7) | $8–10 |
| RDS db.t4g.micro + 20 GB gp3 + 7-day backups (single-AZ) | $14–16 |
| ALB (base + minimal traffic) | $16–18 |
| S3 + CloudFront (near/inside free tier) | $1–3 |
| Route 53 + Secrets Manager + CloudWatch | $3–4 |
| Cognito (<50k MAU) / SES (per-email) | ~$0 |
| **Total** | **≈ $45/mo** |

### Why it's already zero-downtime
- **PWA (S3+CloudFront):** infinite scale, no ops, never any downtime.
- **API (Fargate behind ALB):** ECS rolling deploys default to start-before-stop
  (minHealthy 100% / max 200%) — a new task launches, the ALB health-checks it on
  `/health`, traffic shifts, the old task drains. Zero downtime even at 1 task.

### Make it scale *automatically* (free — you stay at 1 task until real load)
Today `desired_count = 1` with no autoscaling. Add target-tracking so it scales
itself, and a circuit breaker so a bad rollout auto-reverts:
```hcl
resource "aws_appautoscaling_target" "api" {
  min_capacity       = 1
  max_capacity       = 6
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}
resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "tovira-${var.env}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = "ecs"
  target_tracking_scaling_policy_configuration {
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
    target_value       = 60
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
  }
}

# add to resource "aws_ecs_service" "api":
#   health_check_grace_period_seconds = 60           # migrations/boot before ALB judges health
#   deployment_circuit_breaker { enable = true, rollback = true }
```

### The one caveat — the database
The stateless tier scales seamlessly; the DB is the piece that isn't no-downtime
yet:
- **Storage** autoscales to 100 GB already — no downtime.
- **Vertical resize / AZ failure**: RDS is **single-AZ** (a guardrail `check` in
  `database.tf` currently *enforces* `multi_az = false` for cost), so a resize or
  failure is a short outage — no standby to fail over to.
- **When you outgrow 10 users**, flip `multi_az = true` (and relax that guardrail):
  resizes/failovers become a ~60–120s blip instead of an outage. Adds ~$14/mo, so
  keep single-AZ now and flip it once there's revenue. One line, no re-architecture.

### App-side rule for zero-downtime deploys
During a rolling deploy the old and new tasks run **simultaneously** against the
same DB, so schema changes must be **backward-compatible**: add
columns/tables + backfill first, drop the old shape in a *later* deploy
(expand/contract). Migrations run on boot, so this discipline is what keeps a
deploy truly zero-downtime.

### Stockholm caveats
- **Bedrock isn't in `eu-north-1`.** Embeddings therefore call **Frankfurt**
  cross-region: `EMBEDDER=bedrock`, `BEDROCK_REGION=eu-central-1` (the
  `bedrock_region` Terraform var), `EMBED_MODEL=amazon.titan-embed-text-v2:0`. The
  task role's `invoke-bedrock` policy is scoped to `bedrock_region`.
  **One-time console prerequisite:** in the **eu-central-1 Bedrock console → Model
  access**, enable access for `amazon.titan-embed-text-v2:0`, or the `InvokeModel`
  calls fail (recall/search degrade — the app still boots). A stub embedder is no
  longer allowed with a real AI provider (`assertDeployReady` refuses it), and
  `GET /health` + the `[adapters]` boot line report live-vs-stub so a
  non-representative staging is caught immediately.
- The **CloudFront ACM cert must still be in `us-east-1`** (global, region-independent).
- Optional: **Fargate Spot** cuts task compute ~70% (~$3 vs ~$9) but a single Spot
  task can be interrupted — fine if you tolerate the blip, skip if you don't.

## Security review (pre-launch)

Audited the launch-critical surfaces against the real code.

**Strong — no action:**
- **Tenant isolation** enforced at the DB: the API connects as a *non-superuser*
  role and every repository call runs in a transaction that sets
  `set_config('app.user_id', …, true)`, so Postgres RLS scopes every row;
  fail-closed on any error (`db/tenant.ts`). Verified live: a user only ever sees
  their own clients.
- **Passwords**: scrypt with a per-user 16-byte salt, constant-time verify
  (`services/auth/password.ts`).
- **Session tokens**: 256-bit (`randomBytes(32)`), and **stored SHA-256-hashed**
  — a DB leak doesn't yield usable sessions. Cookies are `HttpOnly`,
  `SameSite=Lax`, and `Secure` in production.
- **No user enumeration**: login and forgot-password return generic outcomes.
- **Stripe webhook** verifies the signature (`constructEvent`) and rejects
  forged/unsigned events.
- **Body limits**: JSON capped at 1 MB, uploads at 30 MB; media ingest returns
  413. Errors return generic 500s (no internals leaked).
- **Rate limits** exist on verification-email resends and hero refreshes.

**Gaps:**
1. **[RESOLVED] Login brute-force throttling.** `/auth/login` now throttles per
   IP+email — 8 failed attempts per 15 min, then `429` (even for the correct
   password) until the window rolls over; a success clears the counter. Client IP
   is read from `X-Forwarded-For` behind CloudFront/ALB
   (`services/security/rate-limiter.ts`). In-process (fine for the single API
   task); move to a shared store if the service scales horizontally.
   *Follow-up:* `/auth/forgot-password` is not yet throttled (email-bomb of a
   victim) — a cheap extension with the same limiter.
2. **[RESOLVED] Security response headers.** A CloudFront response-headers policy
   (HSTS, nosniff, `frame-options DENY`, referrer policy) is now attached to both
   behaviors (`storage.tf`). *Optional follow-up:* add a Content-Security-Policy for
   the HTML — the app is self-contained, so a tight `default-src 'self'` is realistic.

## Notes

- **Stripe** is test-mode only through phase 5 (`CLAUDE.md`). Live billing needs a
  real Stripe account + business details — a product/legal step, not code.
- **The gate** (`npm run gate`) runs in CI on `main` once `ANTHROPIC_API_KEY` is
  set, and fails the build if extraction ever guesses a date, fabricates a
  promise, or merges two people.
- **First deploy**: the single ECS task runs migrations on boot; watch
  `/tovira/<env>/api` in CloudWatch for `[migrate] applied …`.
