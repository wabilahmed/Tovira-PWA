variable "region" {
  description = "AWS region (keep components in one region; one AZ early for cost)."
  type        = string
  default     = "eu-west-1"
}

variable "env" {
  description = "Environment name."
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

# Two AZs are required for an ALB and an RDS subnet group even though the RDS
# INSTANCE is single-AZ (multi_az = false) for cost.
variable "azs" {
  type    = list(string)
  default = ["eu-west-1a", "eu-west-1b"]
}

variable "db_instance_class" {
  description = "Graviton, right-sized. Bump only when CloudWatch says so."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_name" {
  type    = string
  default = "tovira"
}

variable "db_username" {
  description = "Superuser/owner used for migrations."
  type        = string
  default     = "tovira"
}

variable "api_image" {
  description = "Full ECR image URI:tag for the API container (set by CI on deploy)."
  type        = string
  default     = ""
}

variable "api_cpu" {
  type    = number
  default = 256 # 0.25 vCPU
}

variable "api_memory" {
  type    = number
  default = 512 # 0.5 GB
}

variable "domain_name" {
  description = "Optional custom domain for the PWA (leave empty to use the CloudFront domain)."
  type        = string
  default     = ""
}

variable "cost_alarm_monthly_usd" {
  description = "Billing alarm threshold — a safety net against surprise bills (P6-4)."
  type        = number
  default     = 100
}

variable "alarm_email" {
  description = "Where cost/error alarms are sent."
  type        = string
  default     = ""
}
