/**
 * [P22-4] Every link an email can carry, built ONLY from the configured app URL (APP_BASE_URL — no
 * fallback) and only to pages the web app actually serves. One place, so a template can never invent a
 * host or a path that 404s (the old `/settings` and `/account/export` links did: neither is an app page).
 */
export interface AppLinks {
  /** The app itself. */
  open: string;
  /** Settings → Billing (the Customer Portal's own /billing return also lands here). */
  billing: string;
  /** Where "Export your data" lives (the export button is in Settings). */
  export: string;
  resetPassword: (token: string) => string;
  invite: (token: string) => string;
  verifyEmail: (token: string) => string;
  /** The owner-only approve endpoint — an API route, so it goes through the /api prefix behind CloudFront. */
  opsApprove: (requestId: string) => string;
  /** [P33] The owner's review page (Approve / Reject / Re-invite buttons; asks for the ops token). */
  opsAccess: string;
}

export function appLinks(appBaseUrl: string): AppLinks {
  const base = appBaseUrl.replace(/\/+$/, '');
  return {
    open: `${base}/app`,
    billing: `${base}/app?view=settings`,
    export: `${base}/app?view=settings`,
    resetPassword: (t) => `${base}/reset-password?token=${encodeURIComponent(t)}`,
    invite: (t) => `${base}/invite?token=${encodeURIComponent(t)}`,
    verifyEmail: (t) => `${base}/verify-email?token=${encodeURIComponent(t)}`,
    opsApprove: (id) => `${base}/api/ops/access-requests/${encodeURIComponent(id)}/approve`,
    opsAccess: `${base}/ops/access`,
  };
}
