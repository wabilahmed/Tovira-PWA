# Convenience wrappers for the automated AWS setup. See DEPLOY.md.
# Requires the AWS CLI (bootstrap/config) and the GitHub CLI `gh` (provision/deploy).
ENV ?= prod
AWS_REGION ?= eu-north-1

.PHONY: bootstrap config provision-plan provision-apply deploy help

help:
	@echo "make bootstrap        # one-time: state bucket + OIDC roles (needs AWS admin creds)"
	@echo "make config           # push .env.prod values into Secrets Manager"
	@echo "make provision-plan   # trigger the Provision workflow (terraform plan)"
	@echo "make provision-apply  # trigger the Provision workflow (terraform apply)"
	@echo "make deploy           # trigger the Deploy workflow (build+ship the app)"

bootstrap:
	ENV=$(ENV) AWS_REGION=$(AWS_REGION) bash scripts/aws-bootstrap.sh

config:
	ENV=$(ENV) AWS_REGION=$(AWS_REGION) bash scripts/load-runtime-config.sh .env.prod

provision-plan:
	gh workflow run "Provision (Terraform)" -f action=plan

provision-apply:
	gh workflow run "Provision (Terraform)" -f action=apply

deploy:
	gh workflow run "Deploy" -f target=both
