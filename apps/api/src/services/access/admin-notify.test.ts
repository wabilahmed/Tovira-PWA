import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessRequestNotifier, adminAlertSender } from './admin-notify.js';
import type { AccessRequestRecord } from '../../ports/access-request-repository.js';

/**
 * [P46-6c.3] Owner: one admin address list. A new access request (and the AI spend alert) emails every address in
 * ADMIN_EMAILS; ACCESS_REQUEST_NOTIFY_TO is gone from the code, the env and Terraform.
 */
const REC = { id: 'r1', fullName: 'Dana', workEmail: 'dana@x.ae' } as unknown as AccessRequestRecord;

describe('[P46-6c.3] admin notifications go to ADMIN_EMAILS', () => {
  it('a new access request emails every address in ADMIN_EMAILS, each with the review links', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const notify = accessRequestNotifier({ sendAccessRequestNotification: send }, ['wabil@tovira.io', 'ops@tovira.io'], 'https://tovira.io');
    await notify!(REC);
    expect(send.mock.calls.map((c) => c[0])).toEqual(['wabil@tovira.io', 'ops@tovira.io']);
    expect(send.mock.calls[0]![2]).toContain('/r1');
    expect(send.mock.calls[0]![3]).toBe('https://tovira.io/admin/access');
  });

  it('NEGATIVE: with no ADMIN_EMAILS there is no notifier (nothing sent anywhere else)', () => {
    expect(accessRequestNotifier({ sendAccessRequestNotification: vi.fn() }, [], 'https://tovira.io')).toBeUndefined();
  });

  it('one failed address does not stop the others', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('bounce')).mockResolvedValue(undefined);
    await accessRequestNotifier({ sendAccessRequestNotification: send }, ['a@tovira.io', 'b@tovira.io'], 'https://tovira.io')!(REC);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('the AI spend alert goes to every admin too', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await adminAlertSender({ send }, ['a@tovira.io', 'b@tovira.io'])({ subject: 's', text: 't' });
    expect(send.mock.calls.map((c) => c[0].to)).toEqual(['a@tovira.io', 'b@tovira.io']);
  });

  it('NEGATIVE: ACCESS_REQUEST_NOTIFY_TO is read nowhere in the API, nor set in Terraform', () => {
    const root = fileURLToPath(new URL('../../../../../', import.meta.url));
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const hits = [...walk(join(root, 'apps/api/src')), ...walk(join(root, 'infra/terraform'))]
      .filter((f) => /\.(ts|tf)$/.test(f) && !f.endsWith('admin-notify.test.ts') && !f.endsWith('infra-terraform.test.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes('ACCESS_REQUEST_NOTIFY_TO'));
    expect(hits).toEqual([]);
  });
});
