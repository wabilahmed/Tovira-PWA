# Security groups — least privilege. The public ALB is the only thing exposed to
# the internet; the API task only accepts traffic from the ALB; RDS only accepts
# traffic from the API task.

resource "aws_security_group" "alb" {
  name        = "tovira-${var.env}-alb"
  description = "Public HTTPS ingress to the API."
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTP (redirect to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "tovira-${var.env}-alb" }
}

resource "aws_security_group" "api" {
  name        = "tovira-${var.env}-api"
  description = "API task; outbound to internet (Groq/Stripe/Bedrock) via IGW."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "From ALB only"
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "tovira-${var.env}-api" }
}

resource "aws_security_group" "rds" {
  name        = "tovira-${var.env}-rds"
  description = "Postgres; reachable only from the API task."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from the API task only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }
  # [BASTION] The one added rule: reach Postgres from the SSM jump host (bastion.tf) — a SG reference,
  # never an IP/CIDR. The DB stays private; access is IAM-gated via Session Manager.
  ingress {
    description     = "Postgres from the SSM bastion (erasure runbook + incident response)"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.bastion.id]
  }
  tags = { Name = "tovira-${var.env}-rds" }
}
