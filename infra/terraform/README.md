# Tovira — AWS infrastructure (Terraform)

Infrastructure-as-code for Phase 6, implementing the locked design in
[`docs/tovira-aws-infra.md`](../../docs/tovira-aws-infra.md). **These files are
authored, not applied** — provisioning is human-gated (the repo's guard hooks
block `aws`/`terraform apply`). Review, then run `terraform apply` yourself.

## What it provisions

| Layer | Resource | Cost lever |
|---|---|---|
| Network | VPC, **public** subnets, IGW, S3 gateway endpoint | **No NAT Gateway** — the #1 surprise bill |
| Database | RDS Postgres 16 `db.t4g.micro`, **Single-AZ**, gp3, encrypted, 7-day backups | Graviton + single-AZ, no RDS Proxy |
| Backend | ECS **Fargate ARM64** (0.25 vCPU / 0.5 GB) + ALB | one task; scale on CloudWatch |
| Frontend | S3 (private) + CloudFront (OAC) | static, free-tier CDN |
| Media | S3 (private); streamed by the API with auth | pennies |
| Auth | Cognito, **TOTP MFA, no SMS** | free at our scale |
| Jobs | EventBridge Scheduler → Lambda (daily scan) | Lambda free tier |
| AI | IAM `bedrock:InvokeModel` on the task role | variable, not fixed |
| Ops | CloudWatch billing + 5xx alarms → SNS | P6-4 safety net |

Two `check` blocks fail `terraform plan` if anyone reintroduces a **NAT Gateway**
or flips **RDS to Multi-AZ** — the same guardrails the P6-1 acceptance test scans
for.

## Cost guardrails baked in (target ~$25–30/mo fixed)

No NAT Gateway · Single-AZ RDS · ARM everywhere (RDS + Fargate + Lambda) ·
Cognito Lite (free) · no RDS Proxy · no Container Insights · CloudFront
`PriceClass_100` · ECR lifecycle (last 10 images).

## Deploy (human steps — the parts I can't do)

1. **Bootstrap state** (optional): create an S3 bucket + enable the `backend "s3"`
   block in `versions.tf`.
2. `terraform init && terraform plan` — review. Set `-var alarm_email=...` and,
   for prod TLS, a `-var domain_name=...` (then add an ACM cert + 443 listener,
   or front the ALB with CloudFront).
3. `terraform apply`.
4. **Fill the runtime config secret** (`runtime_config_secret_arn` output) with the
   real `GROQ_API_KEY`, `STRIPE_SECRET_KEY` (**`sk_test_…` until go-live**),
   `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, and VAPID keypair
   (`npx web-push generate-vapid-keys`).
5. **Create the `tovira_app` DB role** (the non-superuser RLS role) with the
   password in `APP_DB_PASSWORD` — migration `0003_rls.sql` does this locally; in
   prod, run it once as the superuser after the DB is up (or bake into the boot
   migration, which already `CREATE ROLE ... IF NOT EXISTS`).
6. **Build + push** the API image to `ecr_repository_url`, set `-var api_image=…`,
   re-apply (or let CI update the service).
7. **Build + sync** the PWA: `npm run build -w apps/web`, then
   `aws s3 sync apps/web/dist s3://<frontend_bucket>` and invalidate CloudFront.

## How this maps to the Phase 6 stories

- **P6-1 Deploy on AWS** — this stack (no NAT, single-AZ RDS enforced by `check`
  blocks); wire `terraform apply` + image build/push + S3 sync into CI.
- **P6-2 Swap stand-ins via config** — the task env sets `MODEL_PROVIDER=anthropic`,
  `TRANSCRIBER=groq`, `EMBEDDER=bedrock`, `PUSH_SENDER=webpush`,
  `AUTH_STORE=postgres`; the app's ports pick the real adapters (already built +
  tested).
- **P6-3 iOS push on device** — VAPID keys in the secret; verify on a real iPhone
  after home-screen install over the HTTPS CloudFront/ALB URL.
- **P6-4 Ops safety net** — billing + 5xx alarms, RDS backups; do a restore drill.
- **P6-5 Isolation in prod** — RLS is already enforced by the non-superuser
  `tovira_app` connection; verify with two real Cognito accounts.

## Not included on purpose

Custom domain + ACM (add when you have a domain), WAF, Multi-AZ, RDS Proxy,
read replicas, autoscaling policies — all deferred until metrics justify them
(see the "when to spend more" triggers in the infra doc).
