provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = "tovira"
      ManagedBy = "terraform"
      Env       = var.env
    }
  }
}

# CloudFront + ACM for CloudFront must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      Project   = "tovira"
      ManagedBy = "terraform"
      Env       = var.env
    }
  }
}
