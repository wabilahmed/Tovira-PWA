output "api_url" {
  description = "Public API endpoint (front with TLS in production — see README)."
  value       = "http://${aws_lb.api.dns_name}"
}

output "frontend_url" {
  description = "CloudFront URL for the PWA."
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "ecr_repository_url" {
  description = "Push the API image here."
  value       = aws_ecr_repository.api.repository_url
}

output "frontend_bucket" {
  description = "Sync the built PWA (apps/web/dist) here."
  value       = aws_s3_bucket.frontend.bucket
}

output "cloudfront_distribution_id" {
  description = "Set as the CLOUDFRONT_DISTRIBUTION_ID repo variable (deploy invalidation)."
  value       = aws_cloudfront_distribution.frontend.id
}

output "media_bucket" {
  value = aws_s3_bucket.media.bucket
}

output "db_endpoint" {
  value = aws_db_instance.main.address
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_web_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "runtime_config_secret_arn" {
  description = "Fill GROQ/STRIPE/VAPID here after apply."
  value       = aws_secretsmanager_secret.app.arn
}

# The marketing site no longer has its own bucket — it builds into the app's dist
# and ships to the frontend bucket. See `frontend_bucket` above.

output "marketing_url" {
  description = "Marketing landing URL — the merged distribution (apex + www once wired)."
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}
