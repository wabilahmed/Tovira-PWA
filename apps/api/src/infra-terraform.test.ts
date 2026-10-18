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
