# Marketing site (apps/site) — the static landing page at the apex + www. Served
# from its OWN private S3 bucket behind its OWN CloudFront distribution, entirely
# separate from the app (app.tovira.com stays on aws_cloudfront_distribution.frontend
# in storage.tf). A marketing deploy can never touch the product. Same cost
# discipline: private bucket + OAC, PriceClass_100, a managed cache policy, no NAT.
#
# NOT APPLIED. Authored to match the locked infra; apply with the rest at go-live.

resource "aws_s3_bucket" "marketing" {
  bucket = "tovira-${var.env}-marketing-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "marketing" {
  bucket                  = aws_s3_bucket.marketing.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "marketing" {
  bucket = aws_s3_bucket.marketing.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "marketing" {
  name                              = "tovira-${var.env}-marketing"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# The site is a multi-page STATIC build (/, /ar), not a SPA. With an S3 REST
# origin, CloudFront does not auto-append index.html to a directory path, so a
# tiny viewer-request function rewrites "/" and "/ar" -> ".../index.html".
resource "aws_cloudfront_function" "marketing_dir_index" {
  name    = "tovira-${var.env}-marketing-dir-index"
  runtime = "cloudfront-js-2.0"
  comment = "Append index.html for directory-style requests"
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

locals {
  marketing_aliases = var.marketing_domain == "" ? [] : [var.marketing_domain, "www.${var.marketing_domain}"]
}

resource "aws_cloudfront_distribution" "marketing" {
  enabled             = true
  default_root_object = "index.html"
  comment             = "tovira-${var.env} marketing site"
  price_class         = "PriceClass_100" # cheapest edge footprint, same as the app
  aliases             = local.marketing_aliases

  origin {
    domain_name              = aws_s3_bucket.marketing.bucket_regional_domain_name
    origin_id                = "marketing"
    origin_access_control_id = aws_cloudfront_origin_access_control.marketing.id
  }

  default_cache_behavior {
    target_origin_id       = "marketing"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.marketing_dir_index.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Default CloudFront cert until a domain + ACM cert (us-east-1) are provided.
  # Provide var.marketing_domain and var.marketing_acm_certificate_arn to serve
  # the apex + www over the real domain.
  dynamic "viewer_certificate" {
    for_each = var.marketing_acm_certificate_arn == "" ? [1] : []
    content {
      cloudfront_default_certificate = true
    }
  }
  dynamic "viewer_certificate" {
    for_each = var.marketing_acm_certificate_arn == "" ? [] : [1]
    content {
      acm_certificate_arn      = var.marketing_acm_certificate_arn
      ssl_support_method       = "sni-only"
      minimum_protocol_version = "TLSv1.2_2021"
    }
  }
}

resource "aws_s3_bucket_policy" "marketing" {
  bucket = aws_s3_bucket.marketing.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.marketing.arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.marketing.arn }
      }
    }]
  })
}
