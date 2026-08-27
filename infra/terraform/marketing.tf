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
  # The exact hostname(s) the distribution answers on. A bare subdomain
  # (staging.tovira.io) is used as-is; an apex adds www too. Empty → default CF
  # cert only.
  marketing_aliases = var.marketing_domain == "" ? [] : (
    length(split(".", var.marketing_domain)) > 2 ? [var.marketing_domain] : [var.marketing_domain, "www.${var.marketing_domain}"]
  )
}

# Directory-index rewrite for the prerendered marketing pages: an S3 REST origin
# does not auto-append index.html, so `/privacy` and `/ar` (dotless, no trailing
# file) map to `.../index.html`. Static assets (with a dot) pass through; app
# routes 404 at the origin and fall back to /app.html (see storage.tf). Associated
# with the frontend distribution in storage.tf.
resource "aws_cloudfront_function" "frontend_dir_index" {
  name    = "tovira-${var.env}-frontend-dir-index"
  runtime = "cloudfront-js-2.0"
  comment = "Marketing directory-index + SPA fallback (S3 behavior only; /api bypasses this)"
  publish = true
  # Runs on the S3 (default) behavior only — /api/* has its own behavior and is
  # never seen here. Static files (a dot in the path) pass through. The prerendered
  # marketing pages map to their index.html. Everything else dotless is an app
  # client-side route and is served the app shell — replacing the old
  # custom_error_response fallback, which could not be scoped away from /api.
  code = <<-JS
    var MARKETING = ['/privacy', '/terms'];
    function handler(event) {
      var req = event.request;
      var uri = req.uri;
      if (uri.indexOf('.') !== -1) { return req; }           // real static asset
      if (uri === '/') { req.uri = '/index.html'; return req; }
      var trimmed = uri.endsWith('/') ? uri.slice(0, -1) : uri;
      if (MARKETING.indexOf(trimmed) !== -1) {               // prerendered marketing page
        req.uri = trimmed + '/index.html';
        return req;
      }
      req.uri = '/app.html';                                 // app client-side route
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
