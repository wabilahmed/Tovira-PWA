import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { WhatsAppApi, WhatsAppStatus } from './whatsappClient.js';

/**
 * [P75 · owner] One WhatsApp status for the whole app, so the Today banner, Settings → WhatsApp and the first sign-in
 * step always agree: verify in one place and the others know at once, without a page reload. It is checked again
 * whenever the app comes back to the front (the rep returns from WhatsApp), and every few seconds while a code is out.
 * `status`: undefined = loading, null = WhatsApp is switched off for this rep (nothing is shown anywhere).
 */
export interface PendingCode { code: string; waLink: string; expiresAt: number; phone: string }
export interface WhatsAppState {
  status: WhatsAppStatus | null | undefined;
  pending: PendingCode | null;
  error: string | null;
  busy: boolean;
  /** A new code for `phone` (the server voids the old one and any number waiting for confirmation). */
  start(phone: string): Promise<void>;
  confirm(accept: boolean): Promise<void>;
  unlink(): Promise<void>;
  /** Back to the start (forget the code shown; it still expires on the server). */
  reset(): void;
  refresh(): Promise<void>;
}

const Ctx = createContext<WhatsAppState | null>(null);

export function WhatsAppStatusProvider({ api, children, pollMs = 4000, onChange }: { api: WhatsAppApi; children: ReactNode; pollMs?: number; onChange?: (s: WhatsAppStatus | null) => void }): JSX.Element {
  const [status, setStatusState] = useState<WhatsAppStatus | null | undefined>(undefined);
  const [pending, setPending] = useState<PendingCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const changed = useRef(onChange);
  changed.current = onChange;

  const apply = useCallback((s: WhatsAppStatus | null) => {
    if (!alive.current) return;
    setStatusState(s);
    if (s?.linked) setPending(null);
    changed.current?.(s);
  }, []);
  const refresh = useCallback(async () => { apply(await api.status()); }, [api, apply]);

  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, [refresh]);

  // Back from WhatsApp: check again.
  useEffect(() => {
    const onFocus = (): void => { void refresh(); };
    const onVisible = (): void => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);

  // While a code is out (until it expires), or a number waits for confirmation: check every few seconds.
  const waiting = !!pending || !!status?.awaitingConfirm;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      if (pending && Date.now() > pending.expiresAt) { setPending(null); setError('That code expired. Tap Verify now for a new one.'); return; }
      void refresh();
    }, pollMs);
    return () => clearInterval(t);
  }, [waiting, pending, pollMs, refresh]);

  const value = useMemo<WhatsAppState>(() => ({
    status, pending, error, busy, refresh,
    async start(phone) {
      setError(null); setBusy(true);
      const r = await api.startLink(phone);
      setBusy(false);
      if (!r.ok) { setError(r.message); return; }
      setPending({ code: r.code, waLink: r.waLink, expiresAt: r.expiresAt, phone: r.phone });
      if (status?.awaitingConfirm) apply({ ...status, awaitingConfirm: null }); // the server voided it
    },
    async confirm(accept) {
      setError(null);
      const s = await api.confirm(accept);
      if (!s) { setError(accept ? 'That has expired. Tap Verify now for a new code.' : null); await refresh(); return; }
      setPending(null);
      apply(s);
    },
    async unlink() { const s = await api.unlink(); if (s) apply(s); },
    reset() { setPending(null); setError(null); },
  }), [status, pending, error, busy, api, apply, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The shared state (switched off when there is no provider: nothing WhatsApp is shown). */
export function useWhatsApp(): WhatsAppState {
  return useContext(Ctx) ?? OFF;
}
const OFF: WhatsAppState = {
  status: null, pending: null, error: null, busy: false,
  start: async () => undefined, confirm: async () => undefined, unlink: async () => undefined, reset: () => undefined, refresh: async () => undefined,
};

/** "18 Nov 2026" */
export function verifiedDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
