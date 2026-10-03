# budget.tf — [USAGE-ALLOWANCE · Task 7] Provider-side Bedrock spend backstop.
#
# Production runs on Bedrock, which has NO hard spend cap, and the application no longer has a global
# ceiling (removed by the usage-allowance batch — the per-account monthly allowance is the real-time
# wall). This AWS Budget is the last line of defence: it emails at 80% and 100% of a monthly Bedrock
# COST budget and, at 100%, ATTACHES an IAM deny for Bedrock InvokeModel* to the ECS task role — which
# stops every model call provider-side, platform-wide.
#
# IMPORTANT: AWS Budgets cost data LAGS BY HOURS. This is a BACKSTOP, not a real-time cap. The
# application's per-account allowance + kill switch (AI_PAUSED) are the real-time controls; this exists
# only to bound a catastrophic runaway the app somehow failed to stop.
#
# HOW TO LIFT THE DENY once it has tripped (model calls return AccessDenied):
#   aws iam detach-role-policy \
#     --role-name tovira-prod-task \
#     --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/tovira-prod-bedrock-denied
# Do NOT delete the policy — the budget action re-attaches it the next time the budget is exceeded.
# (Get <ACCOUNT_ID> from `aws sts get-caller-identity`; the policy ARN is also a terraform output below.)

variable "bedrock_monthly_budget_usd" {
  description = "Monthly Amazon Bedrock COST budget (USD). At 100% a deny policy is attached to the ECS task role."
  type        = number
  default     = 100
}

# [TASK-7 CHECK] Anthropic Claude invoked via Bedrock may bill under the "Amazon Bedrock" SERVICE, OR as
# an AWS MARKETPLACE line item (Service = "AWS Marketplace", under the Anthropic listing) — depending on
# how the account subscribed to the model. A budget filtered on "Amazon Bedrock" ALONE could then never
# trip. I cannot know this account's exact Marketplace value offline, so the Service filter is a VARIABLE
# you set after checking Cost Explorer (see the step-by-step note below). The budget's cost filter is an
# OR over these Service values.
#
# HOW TO FIND THE RIGHT VALUE(S) — in AWS Cost Explorer, for a day that definitely had Claude usage:
#   1. Set GROUP BY = "Service". If the Claude spend shows under "Amazon Bedrock", the default is correct.
#   2. If a chunk shows under "AWS Marketplace", GROUP BY = "Legal entity name" (expect "Anthropic PBC" or
#      similar) to confirm it is Claude, then ADD the Service value that carries it to the list below
#      (usually "AWS Marketplace"). Note: Service = "AWS Marketplace" catches ALL marketplace spend; if you
#      run other marketplace subscriptions, isolate Claude with a Cost Category instead (account-specific,
#      out of scope here) and point the budget at that category.
# Do NOT guess the value — set it from what Cost Explorer actually shows for this account.
variable "bedrock_budget_services" {
  description = "Cost Explorer SERVICE dimension values the Bedrock budget sums (OR). Add the Marketplace service value if Claude bills as a Marketplace line item — see the note in budget.tf and verify in Cost Explorer first."
  type        = list(string)
  default     = ["Amazon Bedrock"]
}

# The deny policy. Created but NOT attached in normal operation — the budget action attaches it at 100%.
# An explicit Deny overrides the task role's Allow on bedrock:InvokeModel (iam.tf), so once attached no
# model call can succeed until it is detached.
resource "aws_iam_policy" "bedrock_denied" {
  name        = "tovira-${var.env}-bedrock-denied"
  description = "Deny Bedrock InvokeModel* — attached to the ECS task role by the budget action at 100% of the Bedrock budget."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Deny"
      Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource = "*"
    }]
  })
}

# Execution role AWS Budgets assumes to perform the action (attach/detach the deny policy on the task role).
resource "aws_iam_role" "budget_action" {
  name = "tovira-${var.env}-budget-action"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "budgets.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "budget_action_attach" {
  name = "attach-bedrock-deny"
  role = aws_iam_role.budget_action.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
      Resource = aws_iam_role.task.arn
    }]
  })
}

resource "aws_budgets_budget" "bedrock_monthly" {
  name         = "tovira-${var.env}-bedrock-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.bedrock_monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Scope the budget to the Service value(s) that carry Claude-on-Bedrock spend (see bedrock_budget_services).
  cost_filter {
    name   = "Service"
    values = var.bedrock_budget_services
  }

  # Email at 80% (early warning) and at 100% (which is also the action threshold).
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = ["wabil@prospera-technologies.com"]
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = ["wabil@prospera-technologies.com"]
  }
}

# At 100% of ACTUAL spend, attach the deny policy to the task role. Approval mode AUTOMATIC (no manual
# confirmation — the point is to stop spend without a human in the loop).
resource "aws_budgets_budget_action" "bedrock_deny_at_100" {
  budget_name        = aws_budgets_budget.bedrock_monthly.name
  action_type        = "APPLY_IAM_POLICY"
  approval_model     = "AUTOMATIC"
  notification_type  = "ACTUAL"
  execution_role_arn = aws_iam_role.budget_action.arn

  action_threshold {
    action_threshold_type  = "PERCENTAGE"
    action_threshold_value = 100
  }

  definition {
    iam_action_definition {
      policy_arn = aws_iam_policy.bedrock_denied.arn
      roles      = [aws_iam_role.task.name]
    }
  }

  subscriber {
    address           = "wabil@prospera-technologies.com"
    subscription_type = "EMAIL"
  }
}

output "bedrock_denied_policy_arn" {
  description = "ARN of the Bedrock deny policy (detach this from the task role to lift a tripped backstop)."
  value       = aws_iam_policy.bedrock_denied.arn
}
