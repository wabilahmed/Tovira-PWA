# P6-4 ops safety net: a billing alarm so a surprise bill never goes unnoticed,
# plus an alarm on API 5xx errors. Backups are configured on the RDS instance
# (backup_retention_period = 7). Alerts go to an SNS topic (email subscription).

resource "aws_sns_topic" "alarms" {
  name = "tovira-${var.env}-alarms"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Billing alarms live in us-east-1, and an alarm's SNS action must be in the
# alarm's OWN region — so the billing alarm needs a us-east-1 topic (not the
# regional one above). Only created when an alarm email is set; otherwise the
# console AWS Budget is the cost safety net.
resource "aws_sns_topic" "alarms_use1" {
  provider = aws.us_east_1
  count    = var.alarm_email == "" ? 0 : 1
  name     = "tovira-${var.env}-alarms-use1"
}

resource "aws_sns_topic_subscription" "email_use1" {
  provider  = aws.us_east_1
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms_use1[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Estimated-charges billing alarm (published in us-east-1).
resource "aws_cloudwatch_metric_alarm" "billing" {
  provider            = aws.us_east_1
  count               = var.alarm_email == "" ? 0 : 1
  alarm_name          = "tovira-${var.env}-monthly-cost"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = 21600 # 6h
  statistic           = "Maximum"
  threshold           = var.cost_alarm_monthly_usd
  dimensions          = { Currency = "USD" }
  alarm_actions       = [aws_sns_topic.alarms_use1[0].arn]
}

# API task memory: the Fargate task is 1 GB (var.api_memory) and a 4-way bulk import can spike memory
# with no autoscaling safeguard (autoscaling.tf tracks CPU only). This alarm makes an approaching-OOM
# VISIBLE on the same SNS topic — scaling can't prevent it, but you get warned before the task is killed.
# Service-level AWS/ECS MemoryUtilization is published by default (no Container Insights needed).
resource "aws_cloudwatch_metric_alarm" "api_memory" {
  alarm_name          = "tovira-${var.env}-api-memory"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300 # 5 minutes
  statistic           = "Average"
  threshold           = 80 # percent of the task's 1 GB
  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.api.name
  }
  alarm_actions      = [aws_sns_topic.alarms.arn]
  treat_missing_data = "notBreaching"
}

# API 5xx from the ALB.
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "tovira-${var.env}-api-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  dimensions          = { LoadBalancer = aws_lb.api.arn_suffix }
  alarm_actions       = [aws_sns_topic.alarms.arn]
  treat_missing_data  = "notBreaching"
}
