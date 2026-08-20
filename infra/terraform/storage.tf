# Frontend = static PWA files on S3, served via CloudFront (large perpetual free
# tier). Media (audio + gallery images) live in a PRIVATE bucket; the API streams
# them through /notes/:id/audio and /images/:id with authorization.

# ── Media bucket (private) ───────────────────────────────────────────────────
resource "aws_s3_bucket" "media" {
  bucket = "tovira-${var.env}-media-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ── Frontend bucket (private, behind CloudFront) ─────────────────────────────
resource "aws_s3_bucket" "frontend" {
  bucket = "tovira-${var.env}-web-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "tovira-${var.env}-frontend"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html" # `/` → the prerendered marketing landing
  comment             = "tovira-${var.env} PWA + marketing"
  price_class         = "PriceClass_100" # cheapest edge footprint (guarded in marketing.tf)
  # Apex + www serve this same distribution now (the marketing site was merged in).
  aliases = local.marketing_aliases

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    target_origin_id       = "frontend"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized

    # Directory-index for the prerendered marketing pages (/privacy, /ar → …/index.html).
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.frontend_dir_index.arn
    }
  }

  # SPA fallback: a request that isn't a real file (an app client-side route like
  # /clients or /reset-password) 404s at the origin and serves the APP SHELL —
  # app.html, NOT the marketing landing (which owns `/`).
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/app.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/app.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Default CloudFront cert until a marketing domain + ACM cert (us-east-1) are set.
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

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend.arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn }
      }
    }]
  })
}
