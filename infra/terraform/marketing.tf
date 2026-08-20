# Marketing routes now live INSIDE the PWA build (apps/web): the story-funnel `/`,
# the legal pages, and `/ar` are prerendered STATIC HTML shipped in the SAME dist
# as the app and served by the SAME bucket + CloudFront distribution
# (aws_cloudfront_distribution.frontend in storage.tf). One codebase, one deploy,
# one domain — the apex + www are just aliases on the app distribution.
#
# The separate marketing bucket/distribution/OAC that used to live here are gone
# (apps/site was absorbed into apps/web). NOT APPLIED — authored to match the
# locked infra; apply with the rest at go-live.

locals {
  # Apex + www serve the merged distribution. Empty domain → default CF cert only.
  marketing_aliases = var.marketing_domain == "" ? [] : [var.marketing_domain, "www.${var.marketing_domain}"]
}

# Directory-index rewrite for the prerendered marketing pages: an S3 REST origin
# does not auto-append index.html, so `/privacy` and `/ar` (dotless, no trailing
# file) map to `.../index.html`. Static assets (with a dot) pass through; app
# routes 404 at the origin and fall back to /app.html (see storage.tf). Associated
# with the frontend distribution in storage.tf.
resource "aws_cloudfront_function" "frontend_dir_index" {
  name    = "tovira-${var.env}-frontend-dir-index"
  runtime = "cloudfront-js-2.0"
  comment = "Append index.html for directory-style marketing requests"
  publish = true
  code    = <<-JS
    function handler(event) {
      var req = event.request;
      var uri = req.uri;
      if (uri.endsWith('/')) {
        req.uri = uri + 'index.html';
      } else if (!uri.includes('.')) {
        req.uri = uri + '/index.html';
      }
      return req;
    }
  JS
}

# COST GUARD (mirrors rds_single_az / no_nat_gateway / ses_no_dedicated_ip): the
# single merged distribution must stay on the cheapest edge footprint. A stray
# bump to PriceClass_All is the marketing-era money pit.
check "frontend_price_class" {
  assert {
    condition     = aws_cloudfront_distribution.frontend.price_class == "PriceClass_100"
    error_message = "The frontend distribution must stay PriceClass_100 — apex + www + app all share it now."
  }
}
