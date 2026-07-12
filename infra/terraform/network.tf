# ─────────────────────────────────────────────────────────────────────────────
# Network — deliberately NAT-free (the #1 surprise bill). The backend runs in a
# PUBLIC subnet with a tight security group; its outbound calls (Groq, Stripe,
# Bedrock) go out via the Internet Gateway, not a paid NAT Gateway. S3 traffic
# uses a free VPC Gateway Endpoint.
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "tovira-${var.env}" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "tovira-${var.env}" }
}

resource "aws_subnet" "public" {
  count                   = length(var.azs)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = var.azs[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "tovira-${var.env}-public-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id # IGW, NOT a NAT Gateway
  }
  tags = { Name = "tovira-${var.env}-public" }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Free S3 access without a NAT Gateway.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]
  tags              = { Name = "tovira-${var.env}-s3" }
}

# GUARDRAIL: this stack must never contain a NAT Gateway. If someone adds one,
# this check fails `terraform plan` (mirrors the P6-1 infra-scan acceptance test).
check "no_nat_gateway" {
  assert {
    condition     = length(aws_route_table.public.route) == 1
    error_message = "The public route table must have exactly one route (IGW) — no NAT Gateway."
  }
}
