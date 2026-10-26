import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * [P26-1] Terraform footguns, pinned (the files are read as text — no terraform binary or AWS in the suite):
 *  - the bastion is never replaced just because AWS published a newer AL2023 AMI;
 *  - no Cognito output survives (the pool was removed in P11);
 *  - api_image can never default to — or be set to — the nginx placeholder: prod must name the ECR
 *    tovira/api image, and nothing in the repo supplies a placeholder.
 */
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const tf = join(repo, 'infra/terraform');
const read = (p: string) => readFileSync(join(repo, p), 'utf8');
const allTf = () => readdirSync(tf).filter((f) => f.endsWith('.tf')).map((f) => read(`infra/terraform/${f}`)).join('\n');

describe('[P26-1] terraform', () => {
  it('the bastion ignores AMI drift (lifecycle ignore_changes = [ami])', () => {
    const block = read('infra/terraform/bastion.tf').match(/resource "aws_instance" "bastion" \{[\s\S]*?\n\}/)![0];
    expect(block).toMatch(/lifecycle\s*\{[^}]*ignore_changes\s*=\s*\[\s*ami\s*\]/);
  });

  it('no Cognito resource or output remains', () => {
    expect(allTf()).not.toMatch(/cognito/i);
  });

  it('api_image: no nginx placeholder anywhere — tfvars, workflows, defaults', () => {
    expect(read('infra/terraform/prod.auto.tfvars')).not.toMatch(/nginx|api_image/);
    expect(read('.github/workflows/provision.yml')).not.toMatch(/nginx|PLACEHOLDER_IMAGE/);
    expect(allTf()).not.toMatch(/\b(?:api_)?image\s*=\s*"[^"]*nginx/); // no .tf sets an nginx image (the validation that rejects it may name it)
  });

  it('api_image validation: prod requires the ECR tovira/api image; any env rejects a placeholder', () => {
    const v = read('infra/terraform/variables.tf').match(/variable "api_image" \{[\s\S]*?\n\}/)![0];
    expect(v).toMatch(/default\s*=\s*""/); // empty default → the prod validation fails loudly
    // The prod regex, evaluated here the way Terraform's regex() would (RE2 ⊂ JS for this pattern).
    const m = v.match(/can\(regex\("([^"]+)", var\.api_image\)\)/);
    expect(m).not.toBeNull();
    const re = new RegExp(m![1]!.replace(/\\\\/g, '\\'));
    expect(re.test('862070608699.dkr.ecr.eu-north-1.amazonaws.com/tovira/api:901cd70892cb955c211298c0ad613e852b502663')).toBe(true);
    expect(re.test('public.ecr.aws/nginx/nginx:stable')).toBe(false);
    expect(re.test('')).toBe(false);
    expect(re.test('862070608699.dkr.ecr.eu-north-1.amazonaws.com/tovira/api')).toBe(false); // no tag
    expect(v).toMatch(/strcontains\(lower\(var\.api_image\), "nginx"\)/);
  });

  it('the provision workflow plans with the LIVE service image, refusing anything that is not ECR tovira/api', () => {
    const y = read('.github/workflows/provision.yml');
    expect(y).toMatch(/describe-services/);
    expect(y).toMatch(/api_image=\$\{\{ steps\.live\.outputs\.image \}\}/);
  });
});

/**
 * [P30] The app moves to tovira.io; staging.tovira.io must keep working (sent invites/emails link to it).
 * One Terraform-managed ACM cert (us-east-1, DNS validation) covers tovira.io + www + staging; CloudFront
 * serves all three; the viewer-request function (file) sends www → apex; the apply waits on
 * aws_acm_certificate_validation instead of attaching a pending cert. No pre-made cert ARN variable.
 */
describe('[P30] tovira.io domain', () => {
  it('prod serves tovira.io (+ www) and keeps staging.tovira.io', () => {
    const tfvars = read('infra/terraform/prod.auto.tfvars');
    expect(tfvars).toMatch(/^marketing_domain\s*=\s*"tovira\.io"/m);
    expect(tfvars).toMatch(/^legacy_domains\s*=\s*\["staging\.tovira\.io"\]/m);
    expect(tfvars).not.toMatch(/tovira\.com/);
    expect(read('infra/terraform/marketing.tf')).toMatch(/concat\([\s\S]*var\.legacy_domains/);
  });

  it('one us-east-1 DNS-validated cert covers every alias; CloudFront uses it only once validated', () => {
    const acm = read('infra/terraform/acm.tf');
    expect(acm).toMatch(/resource "aws_acm_certificate" "app"[\s\S]*provider\s*=\s*aws\.us_east_1[\s\S]*validation_method\s*=\s*"DNS"/);
    expect(acm).toMatch(/subject_alternative_names\s*=\s*slice\(local\.marketing_aliases/);
    expect(acm).toMatch(/resource "aws_acm_certificate_validation" "app"/);
    expect(acm).toMatch(/output "app_cert_validation_records"/);
    expect(read('infra/terraform/storage.tf')).toMatch(/acm_certificate_arn\s*=\s*aws_acm_certificate_validation\.app\[0\]\.certificate_arn/);
  });

  it('the old pre-made cert ARN input is gone everywhere (tfvars, variables, provision workflow)', () => {
    expect(read('infra/terraform/prod.auto.tfvars')).not.toMatch(/marketing_acm_certificate_arn/);
    expect(read('infra/terraform/variables.tf')).not.toMatch(/marketing_acm_certificate_arn/);
    expect(read('.github/workflows/provision.yml')).not.toMatch(/marketing_acm_certificate_arn|MARKETING_ACM_CERT_ARN/);
  });

  it('the viewer-request function is loaded from the tested file, not inline', () => {
    expect(read('infra/terraform/marketing.tf')).toMatch(/code\s*=\s*file\("\$\{path\.module\}\/functions\/frontend-viewer-request\.js"\)/);
  });
});

/** [P33] New beta access requests (and the monthly AI-spend alert) email the owner. */
describe('[P33] owner notifications', () => {
  it('the API task sets ACCESS_REQUEST_NOTIFY_TO to the owner\'s address', () => {
    expect(read('infra/terraform/ecs.tf')).toMatch(/\{ name = "ACCESS_REQUEST_NOTIFY_TO", value = "wabil@prospera-technologies\.com" \}/);
  });
});

describe('[P45] admin console secrets', () => {
  it('the API task maps ADMIN_EMAILS and EXPLEE_API_KEY from the app secret, and a fresh env seeds both keys', () => {
    const ecs = read('infra/terraform/ecs.tf');
    for (const k of ['ADMIN_EMAILS', 'EXPLEE_API_KEY']) {
      expect(ecs).toContain(`{ name = "${k}", valueFrom = "\${aws_secretsmanager_secret.app.arn}:${k}::" }`);
      expect(read('infra/terraform/runtime-config.tf')).toMatch(new RegExp(`\\n\\s*${k}\\s*=\\s*"REPLACE_ME"`));
    }
  });
});

describe('[P46-6c.1] every secret the app reads is mapped into the task', () => {
  it('ADMIN_TOTP_KEY is mapped from the app secret, and a fresh env seeds it', () => {
    expect(read('infra/terraform/ecs.tf')).toContain('{ name = "ADMIN_TOTP_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:ADMIN_TOTP_KEY::" }');
    expect(read('infra/terraform/runtime-config.tf')).toMatch(/\n\s*ADMIN_TOTP_KEY\s*=\s*"REPLACE_ME"/);
  });

  // [P46-6c.1 · owner] From now on a new secret key is mapped in ecs.tf in the SAME commit that first reads it. Any
  // env key the API (or its one-off scripts, which run in the same task) reads whose name says secret (…_KEY, …_SECRET,
  // …_TOKEN, …_PASSWORD, DATABASE_URL) must be in the task's `secrets`, read from tovira/prod/app.
  it('NEGATIVE: no secret-named env key is read without an ecs.tf secrets mapping', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const src = join(repo, 'apps/api/src');
    const read_ = new Set<string>();
    for (const f of walk(src)) {
      if (!f.endsWith('.ts') || /\.test\.ts$|\/eval\//.test(f)) continue;
      for (const m of readFileSync(f, 'utf8').matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) read_.add(m[1]!);
    }
    const SECRET = /(_KEY|_SECRET|_TOKEN|_PASSWORD|^DATABASE_URL|^APP_DATABASE_URL)$/;
    const ecs = read('infra/terraform/ecs.tf');
    const mapped = new Set([...ecs.matchAll(/name = "([A-Z0-9_]+)", valueFrom = "\$\{aws_secretsmanager_secret\.app\.arn\}:\1::"/g)].map((m) => m[1]!));
    const unmapped = [...read_].filter((k) => SECRET.test(k) && !mapped.has(k)).sort();
    expect(unmapped).toEqual([]);
    expect(read_.has('ADMIN_TOTP_KEY')).toBe(true); // the guard sees the new key
  });
});
