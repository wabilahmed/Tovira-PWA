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
