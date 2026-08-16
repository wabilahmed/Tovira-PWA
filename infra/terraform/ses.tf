# Transactional email via Amazon SES (lifecycle + password reset + email
# verification). AUTHORED, NOT APPLIED: every resource is gated on var.ses_domain,
# so the default plan (empty domain) creates NOTHING — go-live sets the domain.
#
# Cost posture (mirrors the RDS/NAT guards):
#   - SES has no fixed monthly cost — it is pay-per-message. Good.
#   - The one SES line item that DOES carry a fixed monthly charge is a dedicated
#     IP. We stay on the shared pool; the check block below fails the plan if a
#     dedicated IP is ever switched on without intent.
#   - No NAT: the task already reaches SES over the Internet Gateway.

locals {
  ses_enabled   = var.ses_domain != ""
  ses_mail_from = local.ses_enabled ? "${var.ses_mail_from_subdomain}.${var.ses_domain}" : ""
}

# The sending domain identity, with Easy DKIM (SES-managed signing keys).
resource "aws_sesv2_email_identity" "domain" {
  count                  = local.ses_enabled ? 1 : 0
  email_identity         = var.ses_domain
  configuration_set_name = aws_sesv2_configuration_set.tovira[0].configuration_set_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }

  tags = { Name = "tovira-${var.env}" }
}

# Custom MAIL FROM (mail.<domain>) so bounces/complaints align to our domain and
# improve deliverability. Requires the MX + SPF records emitted as outputs below.
resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  count                  = local.ses_enabled ? 1 : 0
  email_identity         = aws_sesv2_email_identity.domain[0].email_identity
  mail_from_domain       = local.ses_mail_from
  behavior_on_mx_failure = "USE_DEFAULT_VALUE" # never silently drop mail on a misconfigured MX
}

# A configuration set on the SHARED IP pool (no dedicated IP → no fixed cost).
resource "aws_sesv2_configuration_set" "tovira" {
  count                  = local.ses_enabled ? 1 : 0
  configuration_set_name = "tovira-${var.env}"

  delivery_options {
    tls_policy = "REQUIRE" # TLS-only delivery
    # No `sending_pool_name` → the AWS-managed shared pool. A dedicated pool here
    # would add a fixed monthly charge; see the guard below.
  }

  sending_options {
    sending_enabled = true
  }

  reputation_options {
    reputation_metrics_enabled = true # bounce/complaint visibility, no extra cost
  }

  tags = { Name = "tovira-${var.env}" }
}

# Let the ECS task send through SES — scoped to our own verified identity only.
resource "aws_iam_role_policy" "task_ses" {
  count = local.ses_enabled ? 1 : 0
  name  = "send-ses"
  role  = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = aws_sesv2_email_identity.domain[0].arn
      Condition = {
        StringEquals = { "ses:FromAddress" = var.ses_from_address }
      }
    }]
  })
}

# Optional: publish the DKIM + MAIL-FROM records automatically when the domain's
# Route 53 zone is managed (zone id supplied). Left empty → humans add the records
# emitted as outputs. Gated so nothing is created by default.
resource "aws_route53_record" "ses_dkim" {
  count   = local.ses_enabled && var.ses_route53_zone_id != "" ? 3 : 0
  zone_id = var.ses_route53_zone_id
  name    = "${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.ses_domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_route53_record" "ses_mail_from_mx" {
  count   = local.ses_enabled && var.ses_route53_zone_id != "" ? 1 : 0
  zone_id = var.ses_route53_zone_id
  name    = local.ses_mail_from
  type    = "MX"
  ttl     = 600
  records = ["10 feedback-smtp.${var.region}.amazonses.com"]
}

resource "aws_route53_record" "ses_mail_from_spf" {
  count   = local.ses_enabled && var.ses_route53_zone_id != "" ? 1 : 0
  zone_id = var.ses_route53_zone_id
  name    = local.ses_mail_from
  type    = "TXT"
  ttl     = 600
  records = ["v=spf1 include:amazonses.com ~all"]
}

# GUARDRAIL: stay on the shared IP pool early — a dedicated IP is the one SES
# resource with a fixed monthly cost (mirrors the RDS single-AZ guard).
check "ses_no_dedicated_ip" {
  assert {
    condition     = var.ses_use_dedicated_ip == false
    error_message = "SES must use the shared IP pool early (ses_use_dedicated_ip = false) — a dedicated IP carries a fixed monthly cost."
  }
}

output "ses_dkim_tokens" {
  description = "Add these three as CNAME records (<token>._domainkey.<domain> → <token>.dkim.amazonses.com) if Route 53 isn't managed here."
  value       = local.ses_enabled ? aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens : []
}

output "ses_mail_from_domain" {
  description = "Custom MAIL FROM subdomain — needs the MX + SPF records (see ses.tf)."
  value       = local.ses_mail_from
}
