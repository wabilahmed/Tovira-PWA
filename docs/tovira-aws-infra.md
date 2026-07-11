# Tovira — AWS Cost-Optimized Infrastructure

*Target: thousands of users. Goal: minimum cost without hobbling the product.*
Last updated: 2026-07-09

---

## Guiding principle

Thousands of users is a **light** load. The money at this stage isn't burned on traffic — it's burned on a fat **fixed monthly floor**: standby capacity, "best-practice" high-availability defaults, and a few notorious always-on AWS services you don't need yet. So the design does two things:

1. **Crush the fixed floor** — the cost you pay whether or not a single rep logs in.
2. **Let only AI cost be variable** — it scales with real usage (and therefore revenue), and prompt caching already keeps it low.

Three levers applied everywhere: **Graviton (ARM)** instances (~20% cheaper, same performance), **single-AZ** early (no paid standby), and **free tiers** (Cognito, Lambda, CloudFront).

---

## Component design (cheapest sensible option for each)

| Layer | Choice | Why it's the cheap option | ~Monthly |
|---|---|---|---|
| **Frontend** | React PWA as static files on **S3 + CloudFront** | No server. CloudFront has a large perpetual free tier; S3 for a small app is pennies. | ~$1–3 |
| **Backend** | One small **Graviton container** — ECS Fargate (0.25 vCPU / 0.5 GB) *or* a `t4g.micro` EC2 running Docker | A single always-on task handles thousands of users. Persistent process = healthy DB connection pool (no RDS Proxy needed). | ~$6–12 |
| **Database** | **RDS PostgreSQL `db.t4g.micro`, Single-AZ, Graviton**, pgvector enabled | Biggest fixed cost, so right-size hard. Single-AZ drops the paid standby (~half the cost). | ~$12–15 |
| **Auth** | **Cognito, Lite tier** | Free tier covers 10,000 MAU — well above thousands. TOTP MFA is free. | $0 |
| **Background jobs** | **EventBridge Scheduler → Lambda** (daily cold/reminder scan) | Comfortably inside Lambda's 1M free requests/mo. | ~$0 |
| **Notifications** | **Web Push (VAPID)** sent from the backend/Lambda | Open browser standard — no AWS service fee. | ~$0 |
| **Gallery images** | **S3** (served via CloudFront) | A few GB = cents. Add Intelligent-Tiering only once it grows. | ~$1–3 |
| **AI: extraction + embeddings** | **Amazon Bedrock** (Haiku 4.5 + Titan/Cohere embeddings) | Variable, not fixed. Prompt caching cuts input up to ~90%; embeddings are ~pennies per million tokens. | ~$10–50 |
| **Transcription** | **Groq (Whisper)** — external | ~$0.04/hr of audio. Negligible. | ~$5–20 |
| **Payments** | **Stripe** — external | Per-transaction fee only (~2.9% + 30¢); no fixed cost. | % of revenue |

---

## The silent money pits to avoid

*This is where cost-minimization actually happens — not in the instance sizes, but in dodging the always-on traps.*

1. **NAT Gateway — the #1 surprise bill.** ~$32/mo just to exist, **plus** a per-GB data charge. The "default" VPC pattern puts your backend in a private subnet and routes its outbound calls (to Groq, Stripe) through a NAT Gateway. Avoid it: run the backend container in a **public subnet with a tight security group**, and use **VPC Gateway Endpoints (free)** for S3. On a small bill, skipping NAT can be the single biggest saving.
2. **Multi-AZ RDS before you need it** — doubles the DB bill for a standby that matters only once you have paying users. Start Single-AZ; upgrade when revenue justifies availability.
3. **RDS Proxy** — an hourly charge; sidestepped entirely by using a persistent container (not all-Lambda) for the API.
4. **x86 instead of Graviton (ARM)** — same work, ~20% more money. Use ARM for RDS and compute.
5. **Over-provisioning** — start at `t4g.micro`; scale only when CloudWatch says so, not preemptively.
6. **Cross-AZ data transfer** — keep components in one AZ early to avoid inter-AZ transfer fees.
7. **Forgotten dev/staging environments** left running 24/7. Shut them down off-hours.
8. **SMS MFA in Cognito** — costs per message. Use free TOTP (authenticator app) instead.

---

## Rough monthly cost (early phase, thousands of users)

**Fixed floor (pay regardless of usage):**
- RDS `t4g.micro` single-AZ: ~$13
- Backend container (Graviton): ~$10
- S3 + CloudFront: ~$3
- Cognito / Lambda / EventBridge: ~$0
- **Fixed subtotal: ~$25–30/mo**

**Variable (scales with real activity + revenue):**
- Bedrock (Haiku + embeddings, cached): ~$10–50
- Groq transcription: ~$5–20
- Stripe: % of revenue

**Headline: ~$40–100/mo total in the early phase.** You can run Tovira for well under $100/mo until you have real traction. The fixed floor is only ~$25–30; everything above it tracks actual usage.

---

## When to spend more (scale-up triggers — don't pre-optimize)

- **RDS CPU / connections consistently high** → bump the instance one size, then add **Multi-AZ** for availability once you have paying users.
- **Backend CPU steady >70%** → add a second task / turn on auto-scaling (Fargate makes this trivial).
- **Approaching 10k Cognito MAU** → still cheap (Lite volume pricing kicks in); just add it to the budget.
- **Load becomes steady and predictable** → buy a **1-year Savings Plan / Reserved Instance** for RDS + compute (~30–40% off). Only after product-market fit — never commit before you know the shape of your usage.

---

## One-paragraph summary

Static frontend on S3/CloudFront, one small Graviton container for the API, a single-AZ `t4g.micro` Postgres with pgvector, Cognito (free at your scale), and Lambda for the daily scan — with AI (Bedrock + Groq) as the only cost that grows with use. Dodge the NAT Gateway and Multi-AZ traps, run everything on ARM, and the whole thing sits around **$25–30/mo fixed** plus usage. Scale each piece only when the metrics demand it.
