# [FOOTGUN-FIX] Correct-by-default prod inputs. Terraform auto-loads *.auto.tfvars, so a bare
# `terraform plan` / `terraform apply` uses THESE instead of the destructive empty defaults — which
# would drop the CloudFront custom domains + the ACM cert, downgrade TLS to TLSv1, and blank the
# container image. The default command is now the correct one; the prod `validation` blocks in
# variables.tf are the loud backstop if this file is ever missing or overridden to empty.
# [P26-1] The container image is deliberately NOT here: it must be the image the service is running,
# passed with -var (variables.tf shows the command). Without it the plan refuses to start.
#
# Non-secret identifiers only. No credentials here.
# [P30] The app is served on tovira.io (+ www, which redirects to it); staging.tovira.io keeps serving
# because invites and emails already sent link to it. The CloudFront cert covering all three is
# Terraform-managed (acm.tf) — there is no cert ARN input any more.
region           = "eu-north-1"
env              = "prod"
marketing_domain = "tovira.io"
legacy_domains   = ["staging.tovira.io"]
