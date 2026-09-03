import { describe, it, expect, vi } from 'vitest';
import { AccountService } from './account-service.js';

// Minimal fakes — deleteAccount only touches auth (getPublicUser + deleteUser),
// the purgeables, and the onDeleted hook.
function make(onDeleted?: (userId: string, email: string) => Promise<void>) {
  const order: string[] = [];
  const auth = {
    getPublicUser: vi.fn(async () => ({ id: 'u', email: 'rep@x.com', referralCode: 'r' })),
    deleteUser: vi.fn(async () => { order.push('deleteUser'); }),
  };
  const purge = { purgeUser: vi.fn(async () => { order.push('purge'); }) };
  const recallSessions = { exportForUser: async () => [], purgeUser: async () => {} } as never;
  const wrapped = onDeleted ? async (u: string, e: string) => { order.push('email'); await onDeleted(u, e); } : undefined;
  const svc = new AccountService(auth as never, {} as never, {} as never, {} as never, {} as never, {} as never, recallSessions, [purge], wrapped);
  return { svc, auth, purge, order };
}

describe('[EMAIL-HOOKS 1c] AccountService.deleteAccount', () => {
  it('sends the deletion confirmation BEFORE the purge (the address is about to be erased)', async () => {
    const onDeleted = vi.fn().mockResolvedValue(undefined);
    const { svc, auth, order } = make(onDeleted);
    await svc.deleteAccount('u');
    expect(onDeleted).toHaveBeenCalledWith('u', 'rep@x.com');
    expect(order).toEqual(['email', 'purge', 'deleteUser']); // email first
    expect(auth.deleteUser).toHaveBeenCalledWith('u');
  });

  // [1d] a failing confirmation must never block or roll back the deletion.
  it('deletes anyway when the confirmation email throws', async () => {
    const onDeleted = vi.fn().mockRejectedValue(new Error('SES down'));
    const { svc, auth, purge } = make(onDeleted);
    await expect(svc.deleteAccount('u')).resolves.toBeUndefined();
    expect(purge.purgeUser).toHaveBeenCalledWith('u');
    expect(auth.deleteUser).toHaveBeenCalledWith('u');
  });

  it('works with no hook configured (delete still purges + removes the user)', async () => {
    const { svc, auth, purge } = make();
    await svc.deleteAccount('u');
    expect(purge.purgeUser).toHaveBeenCalled();
    expect(auth.deleteUser).toHaveBeenCalled();
  });
});
