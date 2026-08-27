import { describe, it, expect, vi } from 'vitest';
import { InstallPromptController } from './installPrompt.js';

function fakeTarget() {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  return {
    target: {
      addEventListener: (type: string, cb: (e: unknown) => void) => {
        (listeners[type] ??= []).push(cb);
      },
    },
    fire: (type: string, e?: unknown) => (listeners[type] ?? []).forEach((cb) => cb(e)),
  };
}

function fakeBip(outcome: 'accepted' | 'dismissed') {
  return {
    preventDefault: vi.fn(),
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome }),
  };
}

describe('InstallPromptController', () => {
  it('starts unavailable and cannot prompt', async () => {
    const { target } = fakeTarget();
    const c = new InstallPromptController(target);
    expect(c.getState()).toBe('unavailable');
    expect(await c.promptInstall()).toBe('unavailable');
  });

  it('becomes available and suppresses the mini-infobar when beforeinstallprompt fires', () => {
    const { target, fire } = fakeTarget();
    const c = new InstallPromptController(target);
    const bip = fakeBip('accepted');
    fire('beforeinstallprompt', bip);
    expect(bip.preventDefault).toHaveBeenCalledTimes(1);
    expect(c.getState()).toBe('available');
  });

  it('prompts, reports acceptance, and marks installed', async () => {
    const { target, fire } = fakeTarget();
    const c = new InstallPromptController(target);
    const bip = fakeBip('accepted');
    fire('beforeinstallprompt', bip);
    const outcome = await c.promptInstall();
    expect(bip.prompt).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('accepted');
    expect(c.getState()).toBe('installed');
  });

  // NEGATIVE: a dismissed prompt can't be reused (the event is single-use).
  it('dismissal hides the button and a second prompt is unavailable', async () => {
    const { target, fire } = fakeTarget();
    const c = new InstallPromptController(target);
    fire('beforeinstallprompt', fakeBip('dismissed'));
    expect(await c.promptInstall()).toBe('dismissed');
    expect(c.getState()).toBe('unavailable');
    expect(await c.promptInstall()).toBe('unavailable');
  });

  it('notifies subscribers on each state change and stops after unsubscribe', () => {
    const { target, fire } = fakeTarget();
    const c = new InstallPromptController(target);
    const seen: string[] = [];
    const off = c.subscribe((s) => seen.push(s));
    fire('beforeinstallprompt', fakeBip('accepted'));
    fire('appinstalled');
    off();
    fire('beforeinstallprompt', fakeBip('accepted')); // no longer observed
    expect(seen).toEqual(['available', 'installed']);
  });

  it('appinstalled marks installed even with no prior prompt', () => {
    const { target, fire } = fakeTarget();
    const c = new InstallPromptController(target);
    fire('appinstalled');
    expect(c.getState()).toBe('installed');
  });

  // NEGATIVE: an already-installed app must not resurface the install button.
  it('respects alreadyInstalled and ignores a late beforeinstallprompt', () => {
    const { target, fire } = fakeTarget();
    const c = new InstallPromptController(target, true);
    expect(c.getState()).toBe('installed');
    fire('beforeinstallprompt', fakeBip('accepted'));
    expect(c.getState()).toBe('installed');
  });
});
