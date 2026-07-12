# Cognito — free at our scale (Lite tier covers 10k MAU). MFA is TOTP (software
# token) only; SMS MFA is disabled because it costs per message.

resource "aws_cognito_user_pool" "main" {
  name                     = "tovira-${var.env}"
  mfa_configuration        = "OPTIONAL"
  auto_verified_attributes = ["email"]

  username_attributes = ["email"]

  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "tovira-${var.env}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false # public SPA client
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
  supported_identity_providers = ["COGNITO"]
  # Add Google here once the org OAuth app exists (spec: email/password + Google).
}
