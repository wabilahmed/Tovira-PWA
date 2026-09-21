# [BASTION] A tiny SSM-only jump host for reaching the PRIVATE prod Postgres (the erasure runbook +
# incident response) WITHOUT making the DB publicly reachable or adding any IP to a security group.
# There is NO SSH and NO inbound port — access is `aws ssm start-session` (IAM-gated, CloudTrail-audited)
# with a port-forward to RDS. Stop the instance when idle (~$0 running cost, only the 8GB EBS ~$0.80/mo).

# AL2023 arm64 (Graviton, matches t4g) — ships with the SSM agent enabled; resolved from the public SSM
# parameter so there is no hardcoded AMI id to rot.
data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_iam_role" "bastion" {
  name = "tovira-${var.env}-bastion"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

# The ONLY policy: SSM core (Session Manager). No DB creds here — psql still needs tovira_app/superuser.
resource "aws_iam_role_policy_attachment" "bastion_ssm" {
  role       = aws_iam_role.bastion.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "bastion" {
  name = "tovira-${var.env}-bastion"
  role = aws_iam_role.bastion.name
}

# No ingress at all (SSM is outbound-initiated). Egress: 443 for the SSM agent, 5432 to reach RDS. Not
# referencing the RDS SG here (avoids a circular SG reference) — the RDS SG's ingress FROM this SG is the
# actual gate (see security.tf).
resource "aws_security_group" "bastion" {
  name        = "tovira-${var.env}-bastion"
  description = "SSM jump host - no inbound; egress to HTTPS (SSM) and Postgres only."
  vpc_id      = aws_vpc.main.id

  egress {
    description = "HTTPS for the SSM agent (reaches SSM over the IGW from the public subnet)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "Postgres to RDS (the RDS SG ingress from this SG is the real gate)"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "tovira-${var.env}-bastion" }
}

resource "aws_instance" "bastion" {
  ami                         = data.aws_ssm_parameter.al2023_arm64.value
  instance_type               = "t4g.nano"
  subnet_id                   = aws_subnet.public[0].id # public subnet + IGW so the SSM agent reaches SSM (no NAT, no VPC endpoints)
  vpc_security_group_ids      = [aws_security_group.bastion.id]
  iam_instance_profile        = aws_iam_instance_profile.bastion.name
  associate_public_ip_address = true

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }
  root_block_device {
    volume_size = 8
    volume_type = "gp3"
    encrypted   = true
  }
  tags = { Name = "tovira-${var.env}-bastion" }
}

output "bastion_instance_id" {
  description = "SSM target for the DB port-forward: aws ssm start-session --target <id>"
  value       = aws_instance.bastion.id
}
