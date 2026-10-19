# [P30] The CloudFront certificate, Terraform-managed: us-east-1 (CloudFront's region), DNS validation,
# covering every hostname the distribution serves — tovira.io, www.tovira.io and the legacy
# staging.tovira.io (a distribution takes exactly one cert, so every alias must be on it).
#
# DNS is NOT managed here (Cloudflare): the validation CNAMEs are an output for the owner to add.
# Two steps, so nothing ever waits on (or attaches) a pending cert:
#   1. create only the cert (target aws_acm_certificate.app), then read
#      `terraform output app_cert_validation_records` and add those CNAMEs at the DNS host;
#   2. once ACM shows the cert ISSUED, run the full apply: the validation below returns at once and
#      CloudFront switches to this cert + the new aliases, in place.
resource "aws_acm_certificate" "app" {
  count    = var.marketing_domain == "" ? 0 : 1
  provider = aws.us_east_1

  domain_name               = local.marketing_aliases[0]
  subject_alternative_names = slice(local.marketing_aliases, 1, length(local.marketing_aliases))
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Waits until ACM reports the cert ISSUED (the CNAMEs are added by hand, so no record FQDNs here). Bounded,
# so a full apply started before the records exist fails fast instead of hanging.
resource "aws_acm_certificate_validation" "app" {
  count           = var.marketing_domain == "" ? 0 : 1
  provider        = aws.us_east_1
  certificate_arn = aws_acm_certificate.app[0].arn

  timeouts {
    create = "15m"
  }
}

output "app_cert_validation_records" {
  description = "Add these CNAMEs at the DNS host (Cloudflare: DNS only, not proxied) to validate the CloudFront cert."
  value = var.marketing_domain == "" ? {} : {
    for o in aws_acm_certificate.app[0].domain_validation_options : o.domain_name => {
      type  = o.resource_record_type
      name  = o.resource_record_name
      value = o.resource_record_value
    }
  }
}
