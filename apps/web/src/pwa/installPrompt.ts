/**
 * Install-prompt controller (P0-5). Chrome fires `beforeinstallprompt` when the
 * PWA meets the install criteria, but since Chrome 68 it no longer shows a banner
 * on its own — the page must stash the event and drive the prompt from its own UI,
 * or the only way in is the easily-missed address-bar icon. This captures the
 * event, tracks availability, and exposes a one-call `promptInstall()`.
 *
 * iOS Safari never fires `beforeinstallprompt` (state stays 'unavailable'); the UI
 * shows the Share → Add to Home Screen hint there instead. Framework-agnostic and
 * fully testable — the event target is injected.
 */

/** The subset of the (non-standard) BeforeInstallPromptEvent we rely on. */
export interface BeforeInstallPromptEventLike {
  preventDefault(): void;
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Just the `addEventListener` we need — `window` satisfies this. */
export interface InstallEventTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

export type InstallState = 'unavailable' | 'available' | 'installed';

export class InstallPromptController {
  private deferred: BeforeInstallPromptEventLike | null = null;
  private state: InstallState;
  private readonly listeners = new Set<(state: InstallState) => void>();

  constructor(target: InstallEventTarget, alreadyInstalled = false) {
    this.state = alreadyInstalled ? 'installed' : 'unavailable';

    target.addEventListener('beforeinstallprompt', (event) => {
      const e = event as BeforeInstallPromptEventLike;
      e.preventDefault(); // suppress Chrome's mini-infobar — we own the prompt
      this.deferred = e;
      if (this.state !== 'installed') this.set('available');
    });

    target.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.set('installed');
    });
  }

  getState(): InstallState {
    return this.state;
  }

  subscribe(listener: (state: InstallState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Show the native install prompt and resolve with the user's choice, or
   * 'unavailable' when no prompt is pending (already installed, iOS, or the event
   * was already consumed — it is single-use).
   */
  async promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const deferred = this.deferred;
    if (!deferred) return 'unavailable';
    this.deferred = null; // a beforeinstallprompt event can be used only once
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // Accepted → 'appinstalled' will also fire, but set eagerly so the button
    // hides immediately. Dismissed → hide too; the same event can't be reused,
    // and Chrome re-fires a fresh one later if the user stays eligible.
    this.set(outcome === 'accepted' ? 'installed' : 'unavailable');
    return outcome;
  }

  private set(state: InstallState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
