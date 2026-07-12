# RDS PostgreSQL — the biggest fixed cost, so right-sized hard: Graviton
# (db.t4g.micro), SINGLE-AZ (no paid standby), pgvector enabled by the app's
# migrations (CREATE EXTENSION). Automated backups on (P6-4). Upgrade to Multi-AZ
# only once paying users justify the availability.

resource "aws_db_subnet_group" "main" {
  name       = "tovira-${var.env}"
  subnet_ids = aws_subnet.public[*].id
  tags       = { Name = "tovira-${var.env}" }
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_instance" "main" {
  identifier     = "tovira-${var.env}"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class # Graviton (t4g)

  allocated_storage     = 20
  max_allocated_storage = 100 # storage autoscaling, no upfront overprovisioning
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result

  multi_az               = false # single-AZ early (cost); flip when revenue justifies
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  backup_retention_period   = 7 # P6-4: daily backups, 7-day retention
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "tovira-${var.env}-final"

  performance_insights_enabled = false # avoid the extra cost early
  apply_immediately            = false

  tags = { Name = "tovira-${var.env}" }
}

# GUARDRAIL: single-AZ is a cost decision — fail the plan if flipped on by accident
# without intent (mirrors the P6-1 infra-scan acceptance test).
check "rds_single_az" {
  assert {
    condition     = aws_db_instance.main.multi_az == false
    error_message = "RDS must be single-AZ early (multi_az = false) to control the fixed cost floor."
  }
}
