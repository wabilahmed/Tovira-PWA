# [FOOTGUN-FIX] Correct-by-default prod inputs. Terraform auto-loads *.auto.tfvars, so a bare
# `terraform plan` / `terraform apply` uses THESE instead of the destructive empty defaults — which
# would drop the CloudFront custom domain + its ACM cert, downgrade TLS to TLSv1, and blank the
# container image. The default command is now the correct one; the prod `validation` blocks in
# variables.tf are the loud backstop if this file is ever missing or overridden to empty.
# [P26-1] The container image is deliberately NOT here: it must be the image the service is running,
# passed with -var (variables.tf shows the command). Without it the plan refuses to start.
#
# Non-secret identifiers only (all already live in the GitHub repo vars MARKETING_DOMAIN /
# MARKETING_ACM_CERT_ARN and mirror provision.yml's -var flags). No credentials here.
region                        = "eu-north-1"
env                           = "prod"
marketing_domain              = "staging.tovira.io"
marketing_acm_certificate_arn = "arn:aws:acm:us-east-1:862070608699:certificate/f244d920-4997-4225-9f8a-ff859ca06730"
