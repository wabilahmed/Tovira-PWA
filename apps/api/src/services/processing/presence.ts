/**
 * [P65-5 · owner] Is the rep's app open? The app polls the processing status every few seconds only while a page is
 * visible, so a recent poll means it is open. In memory (one container); after a restart everyone reads as closed,
 * which errs toward sending the push. Never stored, never per device.
 */
export const OPEN_WINDOW_MS = 20_000;

export class AppPresence {
  private readonly lastSeen = new Map<string, number>();
  constructor(private readonly now: () => number = () => Date.now()) {}
  seen(userId: string): void { this.lastSeen.set(userId, this.now()); }
  isOpen(userId: string): boolean {
    const t = this.lastSeen.get(userId);
    return t !== undefined && this.now() - t <= OPEN_WINDOW_MS;
  }
}
