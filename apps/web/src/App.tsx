import { API_BASE } from './apiBase.js';
import { AccessRequestsAdmin } from './ops/AccessRequestsAdmin.js';
import { HttpOpsAccessClient } from './ops/opsAccessClient.js';
import { useEffect, useRef, useState } from 'react';
import { AuthClient, type Session } from './auth/authClient.js';
import { ResetPassword } from './auth/PasswordReset.js';
import { InviteAccept } from './auth/InviteAccept.js';
import { RequestAccess } from './access/RequestAccess.js';
import { HttpAccessRequestClient } from './access/requestAccessClient.js';
import { LoginScreen } from './auth/LoginScreen.js';
import { VerifyEmailPage, VerifyBanner } from './auth/EmailVerification.js';
import { ClientsClient, anyExtractionInProgress, type ClientSummary, type NoteSummary, type Brief, type LeadStatus } from './clients/clientsClient.js';
import { PointersCard, type Pointer } from './clients/PointersCard.js';
import { LeadStatusFilterBar, LeadStatusPill, LeadStatusSheet, leadStatusCounts, matchesLeadFilter, leadStatusLabel, type LeadFilter } from './clients/LeadStatus.js';
import { searchClients } from './clients/searchClients.js';
import { ClientRow } from './clients/ClientRow.js';
import { OnboardingClient, type SeedingStatus } from './onboarding/onboardingClient.js';
import { BookScanClient } from './bookscan/bookScanClient.js';
import { GetStarted } from './onboarding/GetStarted.js';
import { BulkImportClient } from './import/bulkImportClient.js';
import { BulkImport } from './import/BulkImport.js';
import { BookScan } from './bookscan/BookScan.js';
import { Inventory } from './inventory/Inventory.js';
import { InventoryClient } from './inventory/inventoryClient.js';
import { ClientInventory } from './inventory/ClientInventory.js';
import { BriefMatches } from './inventory/BriefMatches.js';
import { ImportChat } from './import/ImportChat.js';
import { SharedChatPicker } from './import/SharedChatPicker.js';
import { consumeSharedChat, idbSharedChatStore } from './pwa/sharedChat.js';
import { resumePendingNotes } from './capture/resume.js';
import { PromisesClient } from './promises/promisesClient.js';
import { PromisesTracker } from './promises/PromisesTracker.js';
import { ConfirmChitQueue } from './confirm/ConfirmChitQueue.js';
import { Locked } from './billing/Locked.js';
import { LOCKED } from './billing/gated.js';
import { HeroClient } from './hero/heroClient.js';
import { HeroInsights } from './hero/HeroInsights.js';
import { ProactiveClient } from './proactive/proactiveClient.js';
import { Alerts } from './proactive/Alerts.js';
import { MeetingsClient } from './meetings/meetingsClient.js';
import { Meetings } from './meetings/Meetings.js';
import { BillingClient } from './billing/billingClient.js';
import { AllowanceClient } from './usage/allowanceClient.js';
import { UsageMeter } from './usage/UsageMeter.js';
import { Billing } from './billing/Billing.js';
import { BillingReturn } from './billing/BillingReturn.js';
import { PaymentBanner } from './billing/PaymentBanner.js';
import { AiPausedBanner } from './usage/AiPausedBanner.js';
import type { Entitlement } from './billing/billingClient.js';
import { AccountClient } from './account/accountClient.js';
import { AccountControls } from './account/AccountControls.js';
import { FollowUpDraft } from './followup/FollowUpDraft.js';
import { NotesTimeline } from './clients/NotesTimeline.js';
import { NoteMoveClient } from './notes/noteMoveClient.js';
import { notesToExtract } from './notes/extractQueue.js';
import { MoveSuggestions } from './notes/MoveSuggestions.js';
import { ClientPhoneField } from './clients/ClientPhoneField.js';
import { StakeholderMap } from './stakeholders/StakeholderMap.js';
import { RecallClient } from './recall/recallClient.js';
import { Ask } from './recall/Ask.js';
import { CorpusClient } from './corpus/corpusClient.js';
import { CorpusBadge } from './corpus/CorpusBadge.js';
import { MondayClient } from './monday/mondayClient.js';
import { MondayDigest } from './monday/MondayDigest.js';
import { LedgerClient } from './ledger/ledgerClient.js';
import { Ledger } from './ledger/Ledger.js';
import { ShareCardClient } from './share/shareCardClient.js';
import { ShareCard } from './share/ShareCard.js';
import { PushClient } from './push/pushClient.js';
import { enablePush } from './push/enablePush.js';
import { NotificationSetup, type NotificationApi } from './push/NotificationSetup.js';
import { ThemeToggle } from './settings/ThemeToggle.js';
import { TimezoneSetting } from './settings/TimezoneSetting.js';
import { DisclosureLine } from './settings/DisclosureLine.js';
import { formatMonthYear } from './format/dates.js';
import { BriefOpenPromises } from './brief/BriefOpenPromises.js';
import { AppShell } from './shell/AppShell.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { NotFound } from './components/NotFound.js';

/** [AUDIT item 2] Paths the SPA legitimately serves; anything else is a 404. */
// [BILL-13] The Stripe return paths are real app routes (not a 404): success/cancel land on the return
// pages below; /billing is the Customer Portal return → the Billing (Settings) page.
export const BILLING_RETURN_PATHS = ['/billing/success', '/billing/cancel', '/billing'] as const;
export const KNOWN_SPA_PATHS = new Set(['/', '/app', '/reset-password', '/invite', '/verify-email', '/request-access', '/ops/access', ...BILLING_RETURN_PATHS]);
import { InstallBanner } from './pwa/InstallBanner.js';
import { PushView } from './shell/PushView.js';
import type { View } from './shell/nav.js';
import { isView } from './shell/nav.js';
import type { Plan } from './billing/plans.js';
import { useIsDesktop } from './shell/useIsDesktop.js';
import { hapticTick } from './haptics.js';
import { ReceiptThread } from './receipts/ReceiptThread.js';
import { detectStandalone, type OnboardingState } from './onboarding/onboarding.js';
import { Outbox, type PendingRecording } from './capture/outbox.js';
import { registerUnsavedSource } from './pwa/unsavedWork.js';
import { IdbRecordingStore } from './capture/idbRecordingStore.js';
import { HttpUploader } from './capture/uploader.js';
import { requestMicrophone } from './capture/microphone.js';
import { startRecording, type ActiveRecording } from './capture/recorder.js';

const auth = new AuthClient(API_BASE);
const accessRequestApi = new HttpAccessRequestClient(API_BASE);
const opsAccessApi = new HttpOpsAccessClient(API_BASE); // [P33] /ops/access
const clientsApi = new ClientsClient(API_BASE);
const onboardingApi = new OnboardingClient(API_BASE);
const bulkImportApi = new BulkImportClient(API_BASE);
const bookScanApi = new BookScanClient(API_BASE);
const inventoryApi = new InventoryClient(API_BASE);
const promisesApi = new PromisesClient(API_BASE);
const heroApi = new HeroClient(API_BASE);
const proactiveApi = new ProactiveClient(API_BASE);
const meetingsApi = new MeetingsClient(API_BASE);
const noteMoveApi = new NoteMoveClient(API_BASE);
const billingApi = new BillingClient(API_BASE);
const usageApi = new AllowanceClient(API_BASE);
/** [P11-ship] One place every Subscribe-now button goes: start Stripe Checkout for the chosen plan and
 *  send the rep there. Shared by the usage meter, the import upsells and every locked surface. */
const startCheckout = async (plan: Plan): Promise<void> => {
  const url = await billingApi.checkout(plan);
  if (url) window.location.href = url;
};
const accountApi = new AccountClient(API_BASE);
const recallApi = new RecallClient(API_BASE);
const corpusApi = new CorpusClient(API_BASE);
const mondayApi = new MondayClient(API_BASE);
const ledgerApi = new LedgerClient(API_BASE);
const shareCardApi = new ShareCardClient(API_BASE);
const pushClient = new PushClient(API_BASE);

// Optional voice input for recall: use the browser's SpeechRecognition when the
// engine exists, otherwise recall stays text-only (no dead button).
function makeSpeechListener(): (() => Promise<string>) | undefined {
  const w = globalThis as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown };
  const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Recognition) return undefined;
  return () =>
    new Promise<string>((resolve) => {
      const rec = new Recognition() as { start(): void; onresult: (e: { results: Array<Array<{ transcript: string }>> }) => void; onerror: () => void; onend: () => void };
      let heard = '';
      rec.onresult = (e) => { heard = e.results[0]?.[0]?.transcript ?? ''; };
      rec.onerror = () => resolve('');
      rec.onend = () => resolve(heard);
      rec.start();
    });
}
const speechListen = makeSpeechListener();

// Read the current push capability/permission, guarding for non-browser/jsdom.
function readPushState(): OnboardingState {
  const permission =
    typeof Notification !== 'undefined' ? Notification.permission : 'default';
  const pushSupported =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window;
  const standalone =
    typeof window !== 'undefined'
      ? detectStandalone(window as unknown as Parameters<typeof detectStandalone>[0])
      : false;
  return { standalone, notificationPermission: permission, pushSupported };
}

const notificationApi: NotificationApi = {
  enable: () =>
    enablePush({
      vapidPublicKey: (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '',
      requestPermission: () => Notification.requestPermission(),
      getRegistration: () =>
        navigator.serviceWorker
          ? (navigator.serviceWorker.ready as unknown as Promise<import('./push/enablePush.js').PushRegistrationLike>)
          : Promise.resolve(null),
      saveSubscription: (s) => pushClient.saveSubscription(s),
    }),
  sendTest: () => pushClient.sendTest(),
};
const outbox = new Outbox(new IdbRecordingStore(), new HttpUploader(API_BASE));
// [P14-4b] A recording still waiting to upload is unsaved work — a service-worker update must prompt,
// not silently reload, while any is pending. Registered once (the outbox is a singleton).
registerUnsavedSource(async () => (await outbox.pending()).length > 0);

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
}

export function App(): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  // Reached via the emailed reset link (/reset-password?token=…), before auth.
  const [resetToken, setResetToken] = useState<string | null>(() =>
    typeof window !== 'undefined' && window.location.pathname === '/reset-password'
      ? new URLSearchParams(window.location.search).get('token')
      : null,
  );
  // [BETA-6] Reached via the emailed invite link (/invite?token=…), before auth.
  const [inviteToken, setInviteToken] = useState<string | null>(() =>
    typeof window !== 'undefined' && window.location.pathname === '/invite'
      ? new URLSearchParams(window.location.search).get('token')
      : null,
  );
  // Reached via the emailed confirmation link (/verify-email?token=…). Works with
  // or without a session — verification is soft and never gates access.
  const [verifyToken, setVerifyToken] = useState<string | null>(() =>
    typeof window !== 'undefined' && window.location.pathname === '/verify-email'
      ? new URLSearchParams(window.location.search).get('token')
      : null,
  );

  useEffect(() => {
    // On load / refresh: ask the server who we are. Cookie → still logged in.
    auth
      .getSession()
      .then(setSession)
      .finally(() => setLoading(false));
  }, []);

  // [INV-12] Whether self-serve signup is open (public /version flag). Default false = invite-only, so
  // the login page shows "Request beta access" by default and only reveals "Sign up" when it's really on.
  const [signupEnabled, setSignupEnabled] = useState(false);
  useEffect(() => {
    void auth.signupEnabled().then(setSignupEnabled);
  }, []);

  // Public, pre-auth: the beta access-request form (reached from the landing page). Like /reset-password
  // and /verify-email, it is served by the SPA before the session gate (no infra route needed).
  if (typeof window !== 'undefined' && window.location.pathname === '/request-access') {
    return <RequestAccess client={accessRequestApi} />;
  }
  // [P33] The owner's beta-request review page. Pre-auth (it uses the ops token, not a rep session).
  if (typeof window !== 'undefined' && window.location.pathname === '/ops/access') {
    return <AccessRequestsAdmin api={opsAccessApi} />;
  }
  // [BILL-13] Stripe return pages — a rep must never hit a 404 after paying. These render before the
  // session gate (the rep is authed by cookie); the pages poll billing status and route onward.
  if (typeof window !== 'undefined' && window.location.pathname === '/billing/success') {
    return <BillingReturn mode="success" billing={billingApi} />;
  }
  if (typeof window !== 'undefined' && window.location.pathname === '/billing/cancel') {
    return <BillingReturn mode="cancel" billing={billingApi} />;
  }
  // The Customer Portal returns to /billing → send the rep to the Billing page (lives under Settings).
  if (typeof window !== 'undefined' && window.location.pathname === '/billing') {
    window.location.replace('/app?view=settings');
    return <Centered>Returning to Billing…</Centered>;
  }
  if (inviteToken) {
    return (
      <InviteAccept
        auth={auth}
        token={inviteToken}
        onDone={() => {
          if (typeof window !== 'undefined') window.history.replaceState({}, '', '/app');
          setInviteToken(null);
        }}
      />
    );
  }
  if (resetToken) {
    return (
      <ResetPassword
        api={auth}
        token={resetToken}
        onDone={() => {
          if (typeof window !== 'undefined') window.history.replaceState({}, '', '/app');
          setResetToken(null);
        }}
      />
    );
  }
  if (verifyToken) {
    return (
      <Centered>
        <VerifyEmailPage
          api={auth}
          token={verifyToken}
          onDone={() => {
            if (typeof window !== 'undefined') window.history.replaceState({}, '', '/app');
            setVerifyToken(null);
            // Re-read the session so a now-verified account drops the banner.
            void auth.getSession().then(setSession);
          }}
        />
      </Centered>
    );
  }
  // [AUDIT item 2] An unknown SPA path is a 404, not a silent fall-through to the app shell.
  if (typeof window !== 'undefined' && !KNOWN_SPA_PATHS.has(window.location.pathname)) {
    return <Centered><NotFound /></Centered>;
  }
  if (loading) return <Centered>Loading…</Centered>;
  if (!session) return <LoginScreen auth={auth} onAuthed={setSession} signupEnabled={signupEnabled} />;

  return <ClientsScreen session={session} onLogout={() => void auth.logout().then(() => setSession(null))} />;
}

function ClientsScreen({ session, onLogout }: { session: Session; onLogout: () => void }): JSX.Element {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<ClientSummary | null>(null);
  // [P36-1] A chat for a client who doesn't exist yet (or several chats) comes in from the Clients list.
  const [clientsAction, setClientsAction] = useState<'newFromChat' | 'importSeveral' | null>(null);
  // [P36-3] First-run: "New client from a chat" finishes on the batch summary + Open Book Scan (Day One).
  const [onboardingImport, setOnboardingImport] = useState(false);
  // [P36-2] A chat shared into the app waits here until the rep picks its client, then rides to that
  // client's page prefilled (the import there still needs the rep's consent + Import).
  const [sharedFor, setSharedFor] = useState<{ clientId: string; content: string; contentB64: string } | null>(null);
  /** [P36-1] The import started for `clientId` → reload the book and open that client's page. */
  // [P36-2] The prefill is one-shot: leaving that client's page drops it (it never reappears later).
  useEffect(() => { if (sharedFor && open?.id !== sharedFor.clientId) setSharedFor(null); }, [open]);
  /** [P36-2] The rep picked (or created) the shared chat's client → open it with the chat prefilled. */
  const openSharedOn = (c: ClientSummary): void => {
    setSharedFor({ clientId: c.id, content: sharedContent, contentB64: sharedContentB64 });
    setSharedContent('');
    setSharedContentB64('');
    setOpen(c);
  };
  const openImportedClient = async (clientId: string): Promise<void> => {
    const list = await clientsApi.list();
    setClients(list);
    setClientsAction(null);
    const c = list.find((x) => x.id === clientId);
    if (c) setOpen(c);
  };
  // [LEAD-STATUS] The active filter chip, remembered per device (not per account — it's a view
  // preference). Wrapped in try/catch: a private window or blocked storage falls back to "All".
  const [leadFilter, setLeadFilter] = useState<LeadFilter>(() => {
    try {
      const saved = localStorage.getItem('tovira.clients.leadFilter');
      return saved === 'warm' || saved === 'cold' || saved === 'done' || saved === 'unsorted' ? saved : 'all';
    } catch { return 'all'; }
  });
  // The client whose status sheet is open, and a transient toast (rollback error, or drop-out Undo).
  const [statusSheetFor, setStatusSheetFor] = useState<ClientSummary | null>(null);
  const [leadToast, setLeadToast] = useState<{ kind: 'error'; message: string } | { kind: 'undo'; clientId: string; prev: LeadStatus | null; name: string; nowLabel: string } | null>(null);
  const [view, setView] = useState<View>(() => {
    // A `?view=<section>` deep-link opens that section directly (shared links, screenshots-by-URL).
    // Any known view is honoured; an unknown or missing value falls back to Clients. [AUDIT item 2]
    // "Back to Today" from the 404 lands on Today via ?view=today.
    try {
      const q = new URLSearchParams(window.location.search).get('view');
      if (isView(q)) return q;
      // [P36-3] A retired or unknown view (the retired standalone Capture screen) → the Clients list, and the
      // address bar says so — never a blank screen or a 404.
      if (q !== null) {
        const u = new URL(window.location.href);
        u.searchParams.set('view', 'clients');
        window.history.replaceState({}, '', `${u.pathname}${u.search}`);
      }
      return 'clients';
    } catch { return 'clients'; }
  });
  const [seeding, setSeeding] = useState<SeedingStatus | null>(null);
  const [entitled, setEntitled] = useState(true); // default open; the server 402s regardless
  const [billing, setBilling] = useState<Entitlement | null>(null); // [BILLING-DUNNING] drives the failed-payment banner
  const [aiPaused, setAiPaused] = useState(false); // [AUDIT item 4] ops AI-pause → slim "processing delayed" banner
  const [sharedContent, setSharedContent] = useState('');
  const [sharedContentB64, setSharedContentB64] = useState('');
  // Quiet "confirm your email" nudge (EMAIL-VERIFY) — dismissible for the session,
  // never blocks anything. Absent once the account is verified.
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // INV-MATCH: the strong-match unseen count on the Inventory tab (server-computed, per-rep
  // last-viewed). Fetched on load; cleared the moment the rep opens Inventory (marks it seen).
  const [matchBadge, setMatchBadge] = useState(0);
  const isDesktop = useIsDesktop();

  const loadSeeding = (): void => void onboardingApi.status().then(setSeeding);
  useEffect(loadSeeding, []);

  // Entitlement: gate the premium views behind one calm locked state when the
  // trial has lapsed. Default open on a fetch failure — the server 402s anyway.
  useEffect(() => {
    void billingApi.status().then((e) => { setEntitled(e?.entitled ?? true); setBilling(e); });
  }, []);
  // [AUDIT item 4] Surface the ops AI-pause flag (from /allowance/status) so a paused rep sees a reason.
  useEffect(() => {
    void usageApi.status().then((s) => setAiPaused(s?.aiPaused ?? false));
  }, []);
  const gated = (node: JSX.Element): JSX.Element => (entitled ? node : <Locked onSubscribe={startCheckout} status={billing?.status} />);

  // INV-MATCH badge: load the strong-unseen count, and clear it (marking seen) when Inventory opens.
  useEffect(() => {
    void inventoryApi.matches().then((r) => setMatchBadge(r.badge));
  }, []);
  useEffect(() => {
    if (view !== 'inventory' || matchBadge === 0) return;
    void inventoryApi.markMatchesSeen();
    setMatchBadge(0);
  }, [view]);

  // A chat shared into the app via the Android share-target lands in IndexedDB
  // (stashed by the service worker); pick it up once and open seeding prefilled.
  useEffect(() => {
    void consumeSharedChat(idbSharedChatStore, (chat) => {
      setSharedContent(chat.text ?? '');
      setSharedContentB64(chat.base64 ?? '');
      setOpen(null);
      setView('clients'); // [P36-2] → the client picker on the Clients list
    });
  }, []);

  // Resume path (FLOWS-5): advance any note stuck awaiting transcription/extraction
  // on load, across all clients — so a voice note never stalls just because the
  // rep didn't reopen that client's screen.
  useEffect(() => {
    void resumePendingNotes(clientsApi);
  }, []);

  // Load the full client list once, recents-first. [CLIENT-SEARCH] Search is done ON THIS LIST in the
  // browser (below) — the query is NEVER sent to the server, so a client name or phone number can't
  // leak into a CloudFront / ALB access log via the URL.
  useEffect(() => {
    void clientsApi.list().then(setClients);
  }, []);

  // [CLIENT-SEARCH] Debounce the typed query (~200ms) so highlight re-renders stay smooth.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(id);
  }, [query]);

  // [LEAD-STATUS] Remember the last chosen filter chip on this device (best-effort).
  useEffect(() => {
    try { localStorage.setItem('tovira.clients.leadFilter', leadFilter); } catch { /* storage optional */ }
  }, [leadFilter]);

  // [LEAD-STATUS] Apply a rep's status choice with OPTIMISTIC UI: the list updates instantly (no
  // reload). On a save failure we roll the row back and show a toast. On success, if the row no longer
  // matches the active filter it drops out — we surface an Undo toast so the move is never a trap.
  async function changeLeadStatus(client: ClientSummary, next: LeadStatus | null): Promise<void> {
    const prev = client.leadStatus ?? null;
    setStatusSheetFor(null);
    if (prev === next) return; // one tap, one choice — re-picking the current status is a no-op
    setClients((list) => list.map((c) => (c.id === client.id ? { ...c, leadStatus: next, leadStatusChangedAt: Date.now() } : c)));
    const saved = await clientsApi.setLeadStatus(client.id, next);
    if (!saved) {
      // Roll back the optimistic change and tell the rep — nothing was lost.
      setClients((list) => list.map((c) => (c.id === client.id ? { ...c, leadStatus: prev } : c)));
      setLeadToast({ kind: 'error', message: 'Could not update status. Please try again.' });
      return;
    }
    // Keep the open book in sync if it's this client.
    setOpen((o) => (o && o.id === client.id ? { ...o, leadStatus: next, leadStatusChangedAt: saved.leadStatusChangedAt } : o));
    const droppedOut = leadFilter !== 'all' && !matchesLeadFilter({ leadStatus: next }, leadFilter);
    if (droppedOut) setLeadToast({ kind: 'undo', clientId: client.id, prev, name: client.name, nowLabel: leadStatusLabel(next) });
  }

  // Deep link (NUDGE-CONTENT): a pre-meeting nudge opens `/app?client=<id>`. Once the book has
  // loaded, open that client's brief directly (not home), then strip the param so a refresh is clean.
  const [deepClientId, setDeepClientId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('client') : null,
  );
  useEffect(() => {
    if (!deepClientId || !session) return;
    const match = clients.find((c) => c.id === deepClientId);
    if (!match) return;
    setOpen(match);
    setView('clients');
    setDeepClientId(null);
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      const u = new URL(window.location.href);
      u.searchParams.delete('client');
      window.history.replaceState({}, '', `${u.pathname}${u.search}`);
    }
  }, [deepClientId, clients, session]);

  // Mobile pushes the client detail full-screen; desktop keeps it beside the
  // list rail (the §8 split view), so the push only happens off desktop.
  if (open && !isDesktop)
    return (
      <PushView onDismiss={() => setOpen(null)}>
        {(dismiss) => (
          <>
            <ClientDetail
              client={open}
              clients={clients.map((c) => ({ id: c.id, name: c.name }))}
              onBack={() => dismiss()}
              onSubscribe={startCheckout}
              onOpenLeadSheet={() => setStatusSheetFor(open)}
              timeZone={session.user.timezone}
              billingStatus={billing?.status}
              onOpenClient={(id) => { const c = clients.find((x) => x.id === id); if (c) setOpen(c); }}
              initialImport={sharedFor && sharedFor.clientId === open.id ? sharedFor : undefined}
            />
            <LeadStatusSheet client={statusSheetFor} onClose={() => setStatusSheetFor(null)} onPick={(s) => void changeLeadStatus(statusSheetFor!, s)} />
          </>
        )}
      </PushView>
    );

  async function addClient(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await clientsApi.create(name);
      setClients((prev) => [created, ...prev]);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create client.');
    } finally {
      setBusy(false);
    }
  }

  // [LEAD-STATUS] Counts come from the FULL loaded list; the rendered list is the active-filter slice.
  const leadCounts = leadStatusCounts(clients);
  const visibleClients = clients.filter((c) => matchesLeadFilter(c, leadFilter));
  // [CLIENT-SEARCH] When a query is active, the list is the ranked search hits that ALSO match the
  // active status chip (search + filter combine). Below the min length, search is inactive.
  const search = searchClients(clients, debouncedQuery);
  const visibleHits = search.active ? search.hits.filter((h) => matchesLeadFilter(h.client, leadFilter)) : [];
  function undoLeadStatus(t: { clientId: string; prev: LeadStatus | null }): void {
    const c = clients.find((x) => x.id === t.clientId);
    setLeadToast(null);
    if (c) void changeLeadStatus(c, t.prev);
  }

  const needsSeeding = seeding !== null && !seeding.seeded;

  return (
    <AppShell
      view={view}
      onNavigate={setView}
      needsSeeding={needsSeeding}
      badges={{ inventory: matchBadge }}
      sidebarFooter={
        <span>
          {session.user.email}
          <br />
          <button onClick={onLogout} style={linkButton}>Log out</button>
        </span>
      }
    >
      <ErrorBoundary key={view}>
      <DevCrash />{/* dev-only: ?boom=1 throws here so the view ErrorBoundary fallback can be exercised */}
      <InstallBanner />

      {!session.user.emailVerified && !bannerDismissed && (
        <VerifyBanner api={auth} onDismiss={() => setBannerDismissed(true)} />
      )}

      <AiPausedBanner paused={aiPaused} />{/* [AUDIT item 4] ops AI-pause — processing delayed, not broken */}
      <PaymentBanner ent={billing} />{/* [BILLING-DUNNING] shown on every visit while a payment has failed */}

      {view === 'getstarted' && seeding && (
        <GetStarted
          seeding={seeding}
          clients={clients}
          onCreateClient={async (n) => {
            const created = await clientsApi.create(n);
            setClients((prev) => [created, ...prev]);
            return created;
          }}
          importApi={clientsApi}
          bulkImportApi={bulkImportApi}
          sharedContent={sharedContent}
          sharedContentB64={sharedContentB64}
          onAddInventory={() => setView('inventory')}
          onSubscribe={startCheckout}
          onViewBookScan={() => setView('bookscan')}
          onSeeded={() => {
            loadSeeding();
            setSharedContent('');
            setView('bookscan');
          }}
          onFallback={() => setView('clients')}
          onStartImport={() => { setOnboardingImport(true); setClientsAction('newFromChat'); setView('clients'); }}
        />
      )}

      {view === 'today' && gated(
        <>
          <HeroInsights api={heroApi} />
          <MoveSuggestions api={noteMoveApi} clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
          {/* [P34-3] the newest 3 on Today; the rest one tap away */}
          <ConfirmChitQueue api={promisesApi} captures={recallApi} kept={promisesApi} limit={3} onSeeAll={() => setView('confirm')} />
        </>,
      )}

      {view === 'confirm' && (
        <>
          <h2 className="tov-screenhead" style={{ marginTop: 0 }}>To Confirm</h2>
          <ConfirmChitQueue api={promisesApi} captures={recallApi} kept={promisesApi} standalone />
        </>
      )}

      {view === 'week' && gated(
        <>
          <MondayDigest api={mondayApi} onSetOutcome={async (id, choice) => { await clientsApi.setOutcome(id, choice); }} />
          <ConfirmChitQueue api={promisesApi} heading="Guesses to confirm" kept={promisesApi} />
        </>,
      )}

      {view === 'ask' && gated(<Ask api={recallApi} listen={speechListen} />)}

      {view === 'promises' && <PromisesTracker api={promisesApi} />}

      {view === 'meetings' && (
        <Meetings
          api={meetingsApi}
          clients={clients.map((c) => ({ id: c.id, name: c.name }))}
          timeZone={session.user.timezone}
          onCreateClient={async (name) => {
            const created = await clientsApi.create(name);
            setClients((prev) => [created, ...prev]);
            return { id: created.id, name: created.name };
          }}
        />
      )}

      {view === 'alerts' && (
        <>
          <Alerts api={proactiveApi} onSetOutcome={async (id, choice) => { await clientsApi.setOutcome(id, choice); }} />
          <MoveSuggestions api={noteMoveApi} clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
          <ConfirmChitQueue api={promisesApi} captures={recallApi} kept={promisesApi} />
        </>
      )}

      {view === 'bookscan' && gated(
        <>
          <BookScan api={bookScanApi} />
          <ShareCard api={shareCardApi} referralCode={session.user.referralCode} />
        </>,
      )}

      {view === 'ledger' && <Ledger api={ledgerApi} clients={clients.map((c) => ({ id: c.id, name: c.name }))} />}

      {view === 'inventory' && <Inventory api={inventoryApi} clients={clients.map((c) => ({ id: c.id, name: c.name, phone: c.phone ?? null }))} onSubscribe={startCheckout} />}

      {view === 'settings' && (
        <>
          <header className="tov-screenhead" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
            <h2 style={{ marginTop: 0 }}>Settings</h2>
            <CorpusBadge api={corpusApi} />
          </header>
          <p className="tov-setting-line">
            Email: {session.user.email}
            {' — '}
            {session.user.emailVerified ? (
              <span className="tov-verified">Confirmed</span>
            ) : (
              <span className="tov-unverified">Not confirmed yet</span>
            )}
          </p>
          <Billing api={billingApi} />
          {/* [P11-1] a trial rep at 100% gets Subscribe now here → checkout, instead of a dead end. */}
          <UsageMeter api={usageApi} onSubscribe={startCheckout} />
          <ThemeToggle />
          <TimezoneSetting current={session.user.timezone} api={auth} />
          <DisclosureLine />
          <NotificationSetup state={readPushState()} api={notificationApi} />
          <AccountControls api={accountApi} onDeleted={onLogout} />
        </>
      )}

      {view === 'clients' && (
        <div className={isDesktop ? 'tov-split' : undefined}>
          <div className={isDesktop ? 'tov-split__rail' : undefined}>
          <div className="clients-meta">
            <CorpusBadge api={corpusApi} />
            <span>{session.user.email} · <button onClick={onLogout} className="tov-link">Log out</button></span>
          </div>
          <h2 className="clients-title">Clients</h2>
          {/* [P36-1] Capture lives inside a client; a chat for a client you don't have yet starts here. */}
          {(sharedContent || sharedContentB64) && (
            <div data-testid="shared-chat" style={{ margin: '0 0 1rem' }}>
              <SharedChatPicker
                api={bulkImportApi}
                clients={clients.map((c) => ({ id: c.id, name: c.name }))}
                content={sharedContent}
                contentB64={sharedContentB64}
                onChooseClient={(id) => { const c = clients.find((x) => x.id === id); if (c) openSharedOn(c); }}
                onNewClient={(n) => void clientsApi.create(n).then((created) => { setClients((prev) => [created, ...prev]); openSharedOn(created); })}
              />
            </div>
          )}
          {!clientsAction && <div className="clients-actions" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0 0 0.9rem' }}>
            <button type="button" className="tov-primary" onClick={() => setClientsAction('newFromChat')}>New client from a chat</button>
            <button type="button" onClick={() => setClientsAction('importSeveral')}>Import several chats</button>
          </div>}
          {clientsAction && (
            <div data-testid="clients-action" style={{ margin: '0 0 1rem' }}>
              <button type="button" className="tov-link" onClick={() => { setClientsAction(null); setOnboardingImport(false); }}>← Back to clients</button>
              {clientsAction === 'newFromChat'
                ? <BulkImport
                    key="single" api={bulkImportApi} single onSubscribe={startCheckout}
                    onOpenBookScan={() => { loadSeeding(); setClientsAction(null); setOnboardingImport(false); setView('bookscan'); }}
                    onClientReady={onboardingImport ? undefined : (id) => void openImportedClient(id)}
                  />
                : <BulkImport key="several" api={bulkImportApi} onSubscribe={startCheckout} onOpenBookScan={() => setView('bookscan')} />}
            </div>
          )}
          {!clientsAction && <>
          <form onSubmit={addClient} className="clients-add">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New client name"
              aria-label="New client name"
            />
            <button type="submit" className="tov-primary" disabled={busy}>Add</button>
          </form>
          {error && <p style={{ color: 'var(--claret)', margin: '0 0 0.9rem' }}>{error}</p>}

          {/* [CLIENT-SEARCH] One box searches name + phone + email together. The value stays in React
              state and is matched in the browser — it is never put in the request URL. */}
          <div className="clients-search-wrap">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, phone or email…"
              aria-label="Search clients by name, phone or email"
              className="clients-search"
            />
            {query && (
              <button type="button" className="clients-search__clear" aria-label="Clear search" data-testid="search-clear" onClick={() => setQuery('')}>×</button>
            )}
          </div>

          {/* [LEAD-STATUS] Filter chips with per-bucket counts; the active one is highlighted. */}
          <LeadStatusFilterBar filter={leadFilter} counts={leadCounts} onChange={setLeadFilter} />

          {leadToast && (
            <div className="lead-toast" role="status" data-testid="lead-toast">
              {leadToast.kind === 'error' ? (
                <>
                  <span>{leadToast.message}</span>
                  <button type="button" onClick={() => setLeadToast(null)}>Dismiss</button>
                </>
              ) : (
                <>
                  <span><strong>{leadToast.name}</strong> moved to {leadToast.nowLabel}.</span>
                  <button type="button" onClick={() => undoLeadStatus(leadToast)}>Undo</button>
                </>
              )}
            </div>
          )}

          {(search.active ? visibleHits.length === 0 : visibleClients.length === 0) ? (
            <p style={{ color: 'var(--text-secondary)' }} data-testid="clients-empty">
              {clients.length === 0
                ? 'No clients yet. Add your first one above.'
                : search.active
                  ? `No clients match “${query.trim()}”.`
                  : 'No clients match this filter.'}
              {clients.length > 0 && search.active && (
                <> <button type="button" className="tov-link" data-testid="search-clear-empty" onClick={() => setQuery('')}>Clear search</button></>
              )}
              {clients.length > 0 && !search.active && leadFilter !== 'all' && (
                <> <button type="button" className="tov-link" onClick={() => setLeadFilter('all')}>Show all</button></>
              )}
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {search.active
                ? visibleHits.map((h) => (
                    <ClientRow
                      key={h.client.id}
                      client={h.client}
                      onOpen={() => setOpen(h.client)}
                      onOpenStatus={() => setStatusSheetFor(h.client)}
                      match={{ field: h.field, value: h.value, ranges: h.ranges }}
                    />
                  ))
                : visibleClients.map((c) => (
                    <ClientRow key={c.id} client={c} onOpen={() => setOpen(c)} onOpenStatus={() => setStatusSheetFor(c)} />
                  ))}
            </ul>
          )}
          </>}
          </div>
          {isDesktop && (
            <div className="tov-split__detail">
              {open ? (
                <ClientDetail client={open} clients={clients.map((c) => ({ id: c.id, name: c.name }))} onBack={() => setOpen(null)} onSubscribe={startCheckout} onOpenLeadSheet={() => setStatusSheetFor(open)} timeZone={session.user.timezone} billingStatus={billing?.status} onOpenClient={(id) => { const c = clients.find((x) => x.id === id); if (c) setOpen(c); }} initialImport={sharedFor && sharedFor.clientId === open.id ? sharedFor : undefined} />
              ) : (
                <p style={{ color: 'var(--text-secondary)' }}>Select a client to open their book.</p>
              )}
            </div>
          )}
          <LeadStatusSheet client={statusSheetFor} onClose={() => setStatusSheetFor(null)} onPick={(s) => void changeLeadStatus(statusSheetFor!, s)} />
        </div>
      )}
      </ErrorBoundary>
    </AppShell>
  );
}

function ClientDetail({ client, clients = [], onBack, onSubscribe, onOpenLeadSheet, timeZone, billingStatus, onOpenClient, initialImport }: { client: ClientSummary; clients?: Array<{ id: string; name: string }>; onBack: () => void; onSubscribe: (plan: Plan) => void; onOpenLeadSheet?: () => void; timeZone?: string; billingStatus?: string; onOpenClient?: (clientId: string) => void; /** [P36-2] a shared chat to import here, prefilled */ initialImport?: { content: string; contentB64: string } }): JSX.Element {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [pending, setPending] = useState<PendingRecording[]>([]);
  const [active, setActive] = useState<ActiveRecording | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [brief, setBrief] = useState<Brief | typeof LOCKED | null>(null);
  const [showImport, setShowImport] = useState(!!initialImport);
  const [phone, setPhone] = useState<string | null>(client.phone);
  // Notes the server refused to extract because of the trial seeding ceiling. We
  // stop retrying them and show the non-scary ceiling state (no client-side math).
  const [ceilingNoteIds, setCeilingNoteIds] = useState<Set<string>>(new Set());
  // [POINTERS · D8] the client-thread pointers card — appears once pointers exist (after an import),
  // and updates silently as later voice/paste extractions revise the set (refreshed with the notes).
  const [pointers, setPointers] = useState<{ pointers: Pointer[]; disclosure: string | null }>({ pointers: [], disclosure: null });

  const refresh = (): void => {
    void clientsApi.getPointers(client.id).then(setPointers);
    void clientsApi.listNotes(client.id).then(async (list) => {
      setNotes(list);
      // Advance any notes through the pipeline: transcribe, then extract. Skip
      // notes already blocked by the ceiling — retrying just hits it again.
      const toTranscribe = list.filter((n) => n.status === 'pending_transcription');
      // [P16-3c] Skip a note already at the ceiling OR blocked by billing (lapsed trial / failed payment /
      // spent allowance) — the server would only 402 it and the sweep skips it anyway; it resumes when the
      // block clears. (Pure helper so the skip is unit-tested.)
      const toExtract = notesToExtract(list, ceilingNoteIds);
      if (toTranscribe.length > 0 || toExtract.length > 0) {
        const extractResults: Array<{ id: string; status?: string }> = [];
        await Promise.all([
          ...toTranscribe.map((n) => clientsApi.transcribeNote(n.id)),
          ...toExtract.map(async (n) => {
            const r = await clientsApi.extractNote(n.id);
            extractResults.push({ id: n.id, status: r.status });
          }),
        ]);
        const blocked = extractResults.filter((r) => r.status === 'trial_limit').map((r) => r.id);
        if (blocked.length > 0) setCeilingNoteIds((prev) => new Set([...prev, ...blocked]));
        setNotes(await clientsApi.listNotes(client.id));
      }
    });
    // [P36-3] This client's queued recordings (they always carry their client) — not every client's.
    void outbox.pending().then((p) => setPending(p.filter((r) => r.clientId === client.id)));
  };
  useEffect(() => {
    void outbox.flush().then(refresh);
  }, []);
  // [ASYNC-EXTRACT] Extraction runs in the background sweep now, so the timeline must POLL to reflect
  // completion (before this, a note sat on "analysing…" forever until a manual action). Poll every 4s
  // while any note is queued/processing; stop the moment all notes are terminal (done/failed).
  useEffect(() => {
    if (!anyExtractionInProgress(notes)) return;
    const t = setInterval(() => {
      void clientsApi.listNotes(client.id).then(setNotes);
    }, 4000);
    return () => clearInterval(t);
  }, [notes, client.id]);

  // [P14-4b → P36-3] A live recording is unsaved work (its audio is only in memory until stop() enqueues it):
  // a service-worker update must prompt, not reload mid-capture. Moved here with capture from the old screen.
  const recordingRef = useRef(false);
  recordingRef.current = active !== null;
  useEffect(() => registerUnsavedSource(() => recordingRef.current), []);

  async function startRec(): Promise<void> {
    setStatus(null);
    const mic = await requestMicrophone();
    if (!mic.granted || !mic.stream) {
      setStatus(mic.guidance ?? 'Microphone unavailable.');
      return;
    }
    setActive(startRecording(mic.stream));
  }

  async function stopRec(): Promise<void> {
    if (!active) return;
    const blob = await active.stop();
    setActive(null);
    await outbox.enqueue({ id: randomId(), clientId: client.id, blob, createdAt: Date.now() });
    hapticTick(); // the recording is captured — a commit
    refresh();
  }

  async function savePaste(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!paste.trim()) return;
    setStatus(null);
    try {
      await clientsApi.createPasteNote(client.id, paste);
      hapticTick(); // the message is saved — a commit
      setPaste('');
      refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save the message.');
    }
  }

  return (
    <main style={{ fontFamily: 'var(--font-sans)', padding: '2rem', maxWidth: 640, margin: '0 auto' }}>
      <button onClick={onBack} style={linkButton}>← Clients</button>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.15rem' }}>
        <h1 style={{ margin: 0 }}>{client.name}</h1>
        {onOpenLeadSheet && (
          <span data-testid={`lead-pill-book-${client.id}`}>
            <LeadStatusPill status={client.leadStatus} onClick={onOpenLeadSheet} />
          </span>
        )}
      </div>
      {/* Possession language (§10): the client is a holding, on file since a date. */}
      <p className="tov-stamp" style={{ margin: '0 0 0.75rem' }}>
        on file since {formatMonthYear(client.createdAt)} · {notes.length} moment{notes.length === 1 ? '' : 's'}
      </p>

      <ClientPhoneField
        phone={phone}
        onSave={async (p) => {
          const updated = await clientsApi.setPhone(client.id, p);
          setPhone(updated ? updated.phone : p);
        }}
      />

      {pointers.pointers.length > 0 && (
        <div style={{ margin: '0.75rem 0' }}>
          <PointersCard clientName={client.name} pointers={pointers.pointers} disclosure={pointers.disclosure} />
        </div>
      )}

      <button onClick={() => void clientsApi.getBrief(client.id).then(setBrief)}>Pre-meeting brief</button>
      {brief === LOCKED ? (
        <Locked onSubscribe={onSubscribe} status={billingStatus} />
      ) : (
        brief && <BriefPanel brief={brief} clientId={client.id} onChange={() => void clientsApi.getBrief(client.id).then(setBrief)} />
      )}

      <details style={{ margin: '1rem 0' }}>
        <summary style={{ cursor: 'pointer' }}>Stakeholder map</summary>
        <StakeholderMap clientId={client.id} api={clientsApi} />
      </details>

      {active ? (
        <button onClick={() => void stopRec()} style={{ background: 'var(--claret-surface)', borderColor: 'var(--claret)', color: 'var(--claret)', fontWeight: 600 }}>■ Stop &amp; save</button>
      ) : (
        <button className="tov-primary" onClick={() => void startRec()}>● Record voice note</button>
      )}

      <form onSubmit={savePaste} style={{ marginTop: '1rem' }}>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="Paste a message (WhatsApp, email…)"
          aria-label="Paste a message"
          rows={3}
          style={{ width: '100%' }}
        />
        <button type="submit" disabled={!paste.trim()}>Save message</button>
      </form>

      <div style={{ marginTop: '1rem' }}>
        <button onClick={() => setShowImport((s) => !s)} style={linkButton}>
          {showImport ? 'Hide chat import' : 'Import a WhatsApp chat export'}
        </button>
        {showImport && (
          <div style={{ marginTop: '0.75rem' }}>
            <ImportChat
              clientId={client.id}
              api={clientsApi}
              onImported={() => {
                setShowImport(false);
                refresh();
              }}
              onOpenClient={onOpenClient}
              initialContent={initialImport?.content}
              initialContentBase64={initialImport?.contentB64}
            />
          </div>
        )}
      </div>

      {status && <p style={{ color: 'var(--claret)' }}>{status}</p>}
      {pending.length > 0 && (
        <p style={{ color: 'var(--amber)' }}>
          {pending.length} recording(s) pending upload — they’re saved and will retry automatically.
        </p>
      )}

      <ClientInventory api={inventoryApi} clientId={client.id} />

      <h2 style={{ fontSize: '1rem', marginTop: '1.5rem' }}>Notes</h2>
      <NotesTimeline
        notes={notes}
        ceilingNoteIds={ceilingNoteIds}
        timeZone={timeZone}
        onSubscribe={onSubscribe}
        renderFollowUp={(noteId) => <FollowUpDraft noteId={noteId} api={clientsApi} phone={phone ?? undefined} onSubscribe={onSubscribe} status={billingStatus} />}
        move={{
          api: noteMoveApi,
          clientId: client.id,
          clients: clients.filter((c) => c.id !== client.id),
          // The row stays in place showing "Moved to X · Undo" (the control owns that state) so the
          // reverse-move Undo stays reachable; on the next reload the note is correctly gone from here.
        }}
      />
    </main>
  );
}

const linkButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--brass)',
  cursor: 'pointer',
  minHeight: 'auto',
  padding: 0,
  fontFamily: 'inherit',
  fontSize: 'inherit',
};


function BriefPanel({ brief, clientId, onChange }: { brief: Brief; clientId?: string; onChange: () => void }): JSX.Element {
  if (brief.empty) {
    return (
      <section style={briefBox}>
        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Nothing logged yet for {brief.clientName}. Capture a note to build a brief.</p>
      </section>
    );
  }
  return (
    // A prepared memo (§6): the client name in Fraunces, sections ruled by hairlines.
    <section style={briefBox}>
      <h2 style={{ marginTop: 0, marginBottom: '0.25rem' }}>{brief.clientName}</h2>
      <p className="tov-stamp" style={{ margin: '0 0 0.5rem' }}>Pre-meeting brief</p>
      {brief.pointers && brief.pointers.length > 0 && (
        <div style={briefSection}>
          <PointersCard clientName={brief.clientName} clientId={clientId} pointers={brief.pointers} disclosure={brief.pointersDisclosure ?? null} />
        </div>
      )}
      {brief.openPromises.length > 0 && (
        <div style={briefSection}>
          {/* [P18-10b] open promises now carry their receipt (verbatim quote + date). */}
          <BriefOpenPromises promises={brief.openPromises} />
        </div>
      )}
      {brief.needsConfirmation.length > 0 && (
        <div style={briefSection}>
          <div className="tov-stamp" style={{ color: 'var(--amber)' }}>To confirm (not yet facts)</div>
          <ul>
            {brief.needsConfirmation.map((p) => (
              <li key={p.id}>
                {p.text}{' '}
                <button onClick={() => void clientsApi.confirmPromise(p.id).then(onChange)} style={{ marginLeft: 4 }}>Confirm</button>{' '}
                <button onClick={() => void clientsApi.rejectPromise(p.id).then(onChange)}>Reject</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* [INV-MATCH] The inventory suggestions — the primary surface. Receipt visible, share + dismiss inline. */}
      {clientId && <BriefMatches api={inventoryApi} clientId={clientId} />}
      {brief.keyPeople.length > 0 && (
        <div style={briefSection}>
          <div className="tov-stamp">People</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {brief.keyPeople.map((p, i) => {
              const word = ROLE_WORD[p.decision_role] ?? '';
              const blocks = p.decision_role === 'blocker';
              return (
                <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '4px 0' }}>
                  <span>{p.name ?? 'Unknown'}{p.role ? `, ${p.role}` : ''}</span>
                  {word && <span className="tov-stamp" style={blocks ? { color: 'var(--claret)' } : undefined}>{word}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {brief.concerns.length > 0 && (
        <div style={briefSection}><div className="tov-stamp">Concerns</div><ul>{brief.concerns.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
      )}
      {brief.personalNotes.length > 0 && (
        <div style={briefSection}><div className="tov-stamp">Personal notes</div><ul>{brief.personalNotes.map((f, i) => <li key={i}>{f.subject}: {f.fact}</li>)}</ul></div>
      )}
      {brief.relatedNotes.length > 0 && (
        <div style={briefSection}>
          <div className="tov-stamp">Recent context</div>
          <div style={{ display: 'grid', gap: '0.5rem', marginTop: 6 }}>
            {brief.relatedNotes.map((n) => <ReceiptThread key={n.noteId} compact={false} refInfo={{ noteId: n.noteId, span: n.snippet, quote: n.snippet }} />)}
          </div>
        </div>
      )}
    </section>
  );
}

/** Decision-role → the memo's verb (brand: "blocks" is the one claret role). */
const ROLE_WORD: Record<string, string> = {
  decision_maker: 'decides',
  influencer: 'influences',
  blocker: 'blocks',
  unknown: '',
};

const briefBox: React.CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 'var(--radius-card)',
  padding: '1rem 1.25rem',
  margin: '1rem 0',
  background: 'var(--surface-raised)',
};
const briefSection: React.CSSProperties = { borderTop: '1px solid var(--hairline)', paddingTop: '0.6rem', marginTop: '0.6rem' };

/**
 * Dev-only crash trigger. In a production build `import.meta.env.DEV` is false, so this is a no-op that
 * tree-shakes away — it can never throw for a real rep. In dev, `?boom=1` makes it throw during render so
 * the view ErrorBoundary's calm fallback can be captured for QA. Not a route, nothing shippable.
 */
function DevCrash(): JSX.Element | null {
  if (!import.meta.env.DEV) return null;
  let boom = false;
  try { boom = new URLSearchParams(window.location.search).get('boom') === '1'; } catch { boom = false; }
  if (boom) throw new Error('DevCrash: forced render error for ErrorBoundary QA');
  return null;
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ fontFamily: 'var(--font-sans)', display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      {children}
    </div>
  );
}
