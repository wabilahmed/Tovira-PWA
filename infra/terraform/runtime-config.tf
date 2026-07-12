# Runtime config store (AWS Secrets Manager). Injected into the API task at
# runtime — never baked into the image. The DB superuser URL (migrations) and the
# non-superuser app-role URL (RLS at runtime) are both stored here. Fill the
# external values after `apply` — see README. STRIPE MUST be a TEST key
# (sk_test_...) until go-live is approved.

locals {
  database_url     = "postgres://${var.db_username}:${random_password.db.result}@${aws_db_instance.main.address}:5432/${var.db_name}"
  app_database_url = "postgres://tovira_app:${random_password.app_db.result}@${aws_db_instance.main.address}:5432/${var.db_name}"
}

resource "random_password" "app_db" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  name = "tovira/${var.env}/app"
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_URL     = local.database_url
    APP_DATABASE_URL = local.app_database_url
    APP_DB_PASSWORD  = random_password.app_db.result
    # Fill these after apply (or via CI). STRIPE stays TEST MODE until go-live.
    GROQ_API_KEY          = "REPLACE_ME"
    STRIPE_SECRET_KEY     = "sk_test_REPLACE_ME"
    STRIPE_WEBHOOK_SECRET = "whsec_REPLACE_ME"
    STRIPE_PRICE_ID       = "price_REPLACE_ME"
    VAPID_PUBLIC_KEY      = "REPLACE_ME"
    VAPID_PRIVATE_KEY     = "REPLACE_ME"
  })

  lifecycle {
    # Let humans/CI rotate the external keys without Terraform reverting them.
    ignore_changes = [secret_string]
  }
}
