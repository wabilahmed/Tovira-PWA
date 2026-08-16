/**
 * Sentinel a gated API method returns when the server replied 402
 * payment_required (the trial has lapsed). The caller renders the shared
 * {@link Locked} state instead of an empty screen or a raw error — one calm,
 * consistent locked surface everywhere a premium feature is embedded.
 */
export const LOCKED = 'payment_required' as const;
export type Locked = typeof LOCKED;
