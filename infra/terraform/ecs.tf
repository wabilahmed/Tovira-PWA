# One small Graviton (ARM64) Fargate task behind a public ALB. Tasks run in the
# PUBLIC subnets with a public IP so their outbound (Groq/Stripe/Bedrock) uses the
# IGW — no NAT Gateway. A persistent task keeps a healthy DB connection pool, so
# no RDS Proxy is needed.

resource "aws_ecs_cluster" "main" {
  name = "tovira-${var.env}"
  setting {
    name  = "containerInsights"
    value = "disabled" # avoid the extra CloudWatch cost early
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/tovira/${var.env}/api"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "api" {
  family                   = "tovira-${var.env}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64" # Graviton — ~20% cheaper, same work
  }

  container_definitions = jsonencode([{
    name         = "api"
    image        = var.api_image
    essential    = true
    portMappings = [{ containerPort = 3001, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3001" },
      { name = "AUTH_STORE", value = "postgres" },
      { name = "MODEL_PROVIDER", value = "anthropic" },
      { name = "TRANSCRIBER", value = "groq" },
      { name = "EMBEDDER", value = "bedrock" },
      { name = "PUSH_SENDER", value = "webpush" },
      { name = "BEDROCK_REGION", value = var.region },
      { name = "S3_MEDIA_BUCKET", value = aws_s3_bucket.media.bucket },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATABASE_URL::" },
      { name = "APP_DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.app.arn}:APP_DATABASE_URL::" },
      { name = "GROQ_API_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:GROQ_API_KEY::" },
      { name = "STRIPE_SECRET_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:STRIPE_SECRET_KEY::" },
      { name = "STRIPE_WEBHOOK_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:STRIPE_WEBHOOK_SECRET::" },
      { name = "STRIPE_PRICE_ID", valueFrom = "${aws_secretsmanager_secret.app.arn}:STRIPE_PRICE_ID::" },
      { name = "VAPID_PUBLIC_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:VAPID_PUBLIC_KEY::" },
      { name = "VAPID_PRIVATE_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:VAPID_PRIVATE_KEY::" },
    ]
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3001/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "api"
      }
    }
  }])
}

resource "aws_lb" "api" {
  name               = "tovira-${var.env}"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
}

resource "aws_lb_target_group" "api" {
  name        = "tovira-${var.env}-api"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

# HTTP listener. In production, add ACM + a 443 listener (or front with CloudFront
# for TLS) — see README. Kept as HTTP here so the stack applies without a domain.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_ecs_service" "api" {
  name            = "tovira-${var.env}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1 # one task handles thousands of users; scale on CloudWatch
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = true # outbound via IGW — no NAT Gateway
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3001
  }

  depends_on = [aws_lb_listener.http]

  lifecycle {
    ignore_changes = [task_definition] # CI updates the image/task def out of band
  }
}
