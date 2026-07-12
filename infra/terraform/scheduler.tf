# The daily "scheduled brain" (P3): EventBridge Scheduler → Lambda, well inside
# the Lambda free tier. The Lambda calls the API's scan endpoint for each rep
# (the same code the app runs locally), so the scan logic lives in one place.
#
# The function code is a placeholder (deploy your own bundle). It needs outbound
# HTTPS to the ALB; running it OUTSIDE the VPC keeps it NAT-free.

resource "aws_iam_role" "scan_lambda" {
  name = "tovira-${var.env}-scan"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "scan_logs" {
  role       = aws_iam_role.scan_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "archive_file" "scan_placeholder" {
  type        = "zip"
  output_path = "${path.module}/.build/scan.zip"
  source {
    content  = "export const handler = async () => ({ ok: true }); // replace with the real scan trigger"
    filename = "index.mjs"
  }
}

resource "aws_lambda_function" "scan" {
  function_name    = "tovira-${var.env}-scan"
  role             = aws_iam_role.scan_lambda.arn
  runtime          = "nodejs20.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.scan_placeholder.output_path
  source_code_hash = data.archive_file.scan_placeholder.output_base64sha256
  timeout          = 60
  environment {
    variables = {
      API_BASE_URL = "http://${aws_lb.api.dns_name}"
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name = "tovira-${var.env}-scheduler"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "scheduler.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name = "invoke-scan"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "lambda:InvokeFunction", Resource = aws_lambda_function.scan.arn }]
  })
}

resource "aws_scheduler_schedule" "daily_scan" {
  name = "tovira-${var.env}-daily-scan"
  flexible_time_window {
    mode = "OFF"
  }
  schedule_expression = "cron(0 7 * * ? *)" # 07:00 UTC daily
  target {
    arn      = aws_lambda_function.scan.arn
    role_arn = aws_iam_role.scheduler.arn
  }
}
