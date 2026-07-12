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

# Estimated-charges billing alarm (published in us-east-1).
resource "aws_cloudwatch_metric_alarm" "billing" {
  provider            = aws.us_east_1
  alarm_name          = "tovira-${var.env}-monthly-cost"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = 21600 # 6h
  statistic           = "Maximum"
  threshold           = var.cost_alarm_monthly_usd
  dimensions          = { Currency = "USD" }
  alarm_actions       = [aws_sns_topic.alarms.arn]
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
