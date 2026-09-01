variable "region" {
  description = "AWS region (keep components in one region; one AZ early for cost)."
  type        = string
  default     = "eu-north-1" # Stockholm — one of the cheapest regions
}

variable "bedrock_region" {
  description = "Region for Bedrock embeddings — Stockholm has no Bedrock, so the app calls a nearby region cross-region. Enable model access for EMBED_MODEL there (console)."
  type        = string
  default     = "eu-central-1" # Frankfurt — nearest region with Bedrock to Stockholm
}

variable "env" {
  description = "Environment name."
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

# Two AZs are required for an ALB and an RDS subnet group even though the RDS
# INSTANCE is single-AZ (multi_az = false) for cost.
variable "azs" {
  type    = list(string)
  default = ["eu-north-1a", "eu-north-1b"]
}

variable "db_instance_class" {
  # Graviton, right-sized. Bumped to t4g.medium (4GB) as the target for ~170 real
  # users: pgvector's ANN index keeps its own copy of every vector PLUS graph links,
  # so the working set is ~2x the raw vector bytes (~680MB @ 512 dims, 1000 notes/user
  # at 170 users) and must be resident alongside Postgres, connections and shared
  # buffers. On 1–2GB that gets discovered under load; 4GB removes the question for
  # ~$20/mo. Drop back to db.t4g.micro via a tfvar for a truly idle env.
  type    = string
  default = "db.t4g.medium"
}

variable "db_name" {
  type    = string
  default = "tovira"
}

variable "db_username" {
  description = "Superuser/owner used for migrations."
  type        = string
  default     = "tovira"
}

variable "api_image" {
  description = "Full ECR image URI:tag for the API container (set by CI on deploy)."
  type        = string
  default     = ""
}

variable "api_cpu" {
  type    = number
  default = 256 # 0.25 vCPU
}

variable "api_memory" {
  type    = number
  default = 512 # 0.5 GB
}

variable "domain_name" {
  description = "Optional custom domain for the PWA (leave empty to use the CloudFront domain)."
  type        = string
  default     = ""
}

variable "cost_alarm_monthly_usd" {
  description = "Billing alarm threshold — a safety net against surprise bills (P6-4)."
  type        = number
  default     = 100
}

variable "alarm_email" {
  description = "Where cost/error alarms are sent."
  type        = string
  default     = ""
}

# ── Marketing site (apps/site) ───────────────────────────────────────────────
variable "marketing_domain" {
  description = "Apex domain for the marketing site (e.g. tovira.com). Empty = default CloudFront domain, no aliases."
  default     = ""
}

variable "marketing_acm_certificate_arn" {
  description = "ACM cert ARN in us-east-1 covering the apex + www for the marketing CloudFront. Empty = default cert."
  default     = ""
}

# --- Transactional email (SES; authored, not applied — see ses.tf) ---
variable "ses_domain" {
  description = "Sending domain to verify in SES (e.g. tovira.app). Empty = SES not managed by Terraform (default)."
  type        = string
  default     = ""
}

variable "ses_from_address" {
  description = "The exact From address the API sends as (must match EMAIL_FROM's address and live under ses_domain)."
  type        = string
  default     = "no-reply@tovira.app"
}

variable "ses_mail_from_subdomain" {
  description = "Subdomain used for the custom MAIL FROM (bounces/complaints), e.g. `mail` → mail.<ses_domain>."
  type        = string
  default     = "mail"
}

variable "ses_route53_zone_id" {
  description = "Route 53 hosted-zone id for ses_domain. Empty = emit records as outputs for humans to add (default)."
  type        = string
  default     = ""
}

variable "ses_use_dedicated_ip" {
  description = "Keep false early — a dedicated SES IP carries a fixed monthly cost (guarded in ses.tf)."
  type        = bool
  default     = false
}
