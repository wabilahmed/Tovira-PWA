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
import { ClientsClient, anyExtractionInProgress, type ClientSummary, type NoteSummary, type Brief, type LeadStatus, type Stakeholder, type StatusSnapshot } from './clients/clientsClient.js';
import { HttpClientPageClient, type ClientOverview } from './clients/page/clientPageClient.js';
import { Accordion } from './ui/Accordion.js';
import { Page, PageHeader, Section, ListRow, Button, IconButton, ActionRow, SearchInput, Sheet, TextInput, EmptyState } from './ui/index.js';

/** [P36-6] The client-list sort orders. */
const SORT_OPTIONS: Array<{ value: 'last' | 'name' | 'overdue'; label: string }> = [
  { value: 'last', label: 'Last message' },
  { value: 'name', label: 'Name' },
  { value: 'overdue', label: 'Overdue promises' },
];
import { ClientHeader, headerLine } from './clients/page/ClientHeader.js';
import { Conversations, conversationsSummary } from './clients/page/Conversations.js';
import { WantsSection, wantsSummary, PromisesSection, promisesSummary, MeetingsSection, meetingsSummary } from './clients/page/Sections.js';
import { useSections } from './clients/page/useSections.js';
import { PointersCard, type Pointer } from './clients/PointersCard.js';
import { LeadStatusFilterBar, LeadStatusSheet, OutcomeSheet, leadStatusCounts, matchesLeadFilter, leadStatusLabel, type LeadFilter, type StatusSuggestion } from './clients/LeadStatus.js';
import { searchClients } from './clients/searchClients.js';
import { ClientRow, type RowSummary } from './clients/ClientRow.js';
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
import { ConfirmChitQueue, type StatusSuggestionsApi } from './confirm/ConfirmChitQueue.js';
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
import { UsageBanner } from './usage/UsageBanner.js';
import { Tour } from './tour/Tour.js';
import { HttpTourClient } from './tour/tourClient.js';
import { Billing } from './billing/Billing.js';
import { BillingReturn } from './billing/BillingReturn.js';
import { PaymentBanner } from './billing/PaymentBanner.js';
import { AiPausedBanner } from './usage/AiPausedBanner.js';
import type { Entitlement } from './billing/billingClient.js';
import { AccountClient } from './account/accountClient.js';
import { AccountControls } from './account/AccountControls.js';
import { FollowUpDraft } from './followup/FollowUpDraft.js';
import { NoteMoveClient } from './notes/noteMoveClient.js';
import { notesToExtract } from './notes/extractQueue.js';
import { MoveSuggestions } from './notes/MoveSuggestions.js';
import { ClientPhoneField } from './clients/ClientPhoneField.js';
import { StakeholderMap } from './stakeholders/StakeholderMap.js';
import { RecallClient } from './recall/recallClient.js';
import { Ask } from './recall/Ask.js';
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
import { isView, VIEW_LABEL } from './shell/nav.js';
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
import { startRecording, MAX_RECORDING_MS, type ActiveRecording } from './capture/recorder.js';
import { RecordingTimer } from './clients/page/RecordingTimer.js';

const auth = new AuthClient(API_BASE);
const accessRequestApi = new HttpAccessRequestClient(API_BASE);
const opsAccessApi = new HttpOpsAccessClient(API_BASE); // [P33] /ops/access
const clientsApi = new ClientsClient(API_BASE);
const clientPageApi = new HttpClientPageClient(API_BASE); // [P36-5]
const tourApi = new HttpTourClient(API_BASE); // [P37]
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
const mondayApi = new MondayClient(API_BASE);
const ledgerApi = new LedgerClient(API_BASE);
const shareCardApi = new ShareCardClient(API_BASE);
const pushClient = new PushClient(API_BASE);
/** [P36-7] The To Confirm status cards: the rep's answer is the only thing that changes a status.
 *  Mark cold → Cold. Keep warm → Warm + "still open" (resets the going-quiet clock, so it stops suggesting).
 *  Mark lost → Done + lost. Keep open → "still open" (clears the inferred loss, resets the clock). */
const statusSuggestionsApi: StatusSuggestionsApi = {
  list: () => clientsApi.statusSuggestions(),
  apply: async (s) => {
    const ok = (await clientsApi.setLeadStatus(s.clientId, s.status)) !== null;
    if (ok && s.status === 'done') await clientsApi.setOutcome(s.clientId, s.outcome ?? 'lost');
    return ok;
  },
  keep: async (s) => {
    if (s.status === 'cold' && (await clientsApi.setLeadStatus(s.clientId, 'warm')) === null) return false;
    return clientsApi.setOutcome(s.clientId, 'open');
  },
};

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
  // [P37] The required first-login tour: shown whenever the account hasn't completed it (resuming at its saved
  // step), before anything else; "Take the tour again" (More) replays it without touching the record.
  const [tour, setTour] = useState<{ mode: 'required' | 'replay'; start: number } | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/ops')) return; // never on /ops/*
    void tourApi.state().then((t) => { if (t?.required) { setOpen(null); setTour({ mode: 'required', start: t.step }); } });
  }, []);
  // [P39] Every sub-screen has a "← Back" to where the rep came from: a small stack of the screens visited.
  const [trail, setTrail] = useState<View[]>([]);
  const navigate = (v: View): void => {
    if (v === 'tour') { setOpen(null); setTour({ mode: 'replay', start: 0 }); return; }
    if (v === 'ask') v = 'find';
    setOpen(null);
    if (v !== view) setTrail((t) => [...t.slice(-9), view]);
    setView(v);
  };
  /** Back to the previous screen (or `fallback` when there is none, e.g. after a deep link). */
  const goBack = (fallback: View): void => {
    const prev = trail[trail.length - 1];
    setTrail((t) => t.slice(0, -1));
    setView(prev ?? fallback);
  };
  const backTo = (fallback: View): { label: string; onBack: () => void } => {
    const prev = trail[trail.length - 1] ?? fallback;
    return { label: VIEW_LABEL[prev] ?? 'Back', onBack: () => goBack(fallback) };
  };
  // [P37] Settings → Subscription is the one home of "Buy more usage" — every banner and message links here.
  const openSubscription = (): void => navigate('subscription');
  // [P37] Back from a top-up checkout (?topup=1): the usage shows "Updating your balance…" until it lands.
  const [awaitingTopUp, setAwaitingTopUp] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('topup') === '1'; } catch { return false; }
  });
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
  const [leadToast, setLeadToast] = useState<{ kind: 'error'; message: string } | { kind: 'undo'; clientId: string; prev: StatusSnapshot; name: string; nowLabel: string } | null>(null);
  // [P36-7] Done asks how it ended (won / lost → the existing outcome); and what the inference would change,
  // shown in the sheet as a suggestion only.
  const [outcomeFor, setOutcomeFor] = useState<ClientSummary | null>(null);
  const [suggestions, setSuggestions] = useState<Map<string, StatusSuggestion>>(new Map());
  // [P36-6] What each row says (wants line, last message, overdue promises, aliases) and the list's order.
  const [rows, setRows] = useState<Record<string, RowSummary>>({});
  const [sortBy, setSortBy] = useState<'last' | 'name' | 'overdue'>('last');
  const [sortSheet, setSortSheet] = useState(false);
  const [addSheet, setAddSheet] = useState<'menu' | 'name' | null>(null);
  const loadRows = (): void => void clientsApi.rowSummaries().then(setRows);
  const loadSuggestions = (): void => void clientsApi.statusSuggestions().then((list) => setSuggestions(new Map(list.map((x) => [x.clientId, x]))));
  useEffect(loadSuggestions, []);
  const [view, setView] = useState<View>(() => {
    // A `?view=<section>` deep-link opens that section directly (shared links, screenshots-by-URL).
    // Any known view is honoured; an unknown or missing value falls back to Clients. [AUDIT item 2]
    // "Back to Today" from the 404 lands on Today via ?view=today.
    try {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('view');
      if (q === 'ask') return 'find'; // [P39] Ask became Find
      if (q === 'settings' && params.get('topup') === '1') return 'subscription'; // back from a top-up checkout
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
  // [P36-7] A status answered elsewhere (a To Confirm card) shows on the list the moment the rep comes back.
  useEffect(() => {
    if (view !== 'clients') return;
    void clientsApi.list().then(setClients);
    loadSuggestions();
    loadRows();
  }, [view]);

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
  // reload). On a save failure we roll the row back and show a toast. [P36-7] Every change shows an Undo
  // (like Delete); Done then asks Won or Lost unless the rep already said (a "Done (lost)" suggestion).
  async function changeLeadStatus(client: ClientSummary, next: LeadStatus | null, opts: { outcome?: 'won' | 'lost'; undo?: boolean } = {}): Promise<void> {
    const prev = client.leadStatus ?? null;
    const snapshot: StatusSnapshot = { leadStatus: prev, leadStatusChangedAt: client.leadStatusChangedAt ?? null, outcome: client.outcome ?? 'open', outcomeSource: client.outcomeSource ?? null, outcomeChangedAt: client.outcomeChangedAt ?? null };
    setStatusSheetFor(null);
    if (prev === next && !opts.outcome) return; // one tap, one choice — re-picking the current status is a no-op
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
    if (opts.outcome) await setClientOutcome(client, opts.outcome);
    loadSuggestions();
    if (opts.undo) { setLeadToast(null); return; }
    setLeadToast({ kind: 'undo', clientId: client.id, prev: snapshot, name: client.name, nowLabel: next === 'done' && opts.outcome ? `Done (${opts.outcome})` : leadStatusLabel(next) });
    if (next === 'done' && !opts.outcome) setOutcomeFor({ ...client, leadStatus: next });
  }

  /** [P36-7] The existing outcome: won / lost (rep-sourced — the nightly inference never overwrites it). */
  async function setClientOutcome(client: ClientSummary, outcome: 'won' | 'lost' | 'open'): Promise<void> {
    if (!(await clientsApi.setOutcome(client.id, outcome))) return;
    const stored = outcome === 'lost' ? 'lost_confirmed' : outcome;
    setClients((list) => list.map((c) => (c.id === client.id ? { ...c, outcome: stored } : c)));
    setLeadToast((t) => (t && t.kind === 'undo' && t.clientId === client.id && outcome !== 'open' ? { ...t, nowLabel: `Done (${outcome})` } : t));
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
              onOpenSubscription={openSubscription}
            />
            <LeadStatusSheet client={statusSheetFor} suggestion={statusSheetFor ? suggestions.get(statusSheetFor.id) ?? null : null} onClose={() => setStatusSheetFor(null)} onPick={(s, outcome) => void changeLeadStatus(statusSheetFor!, s, { outcome })} />
            <OutcomeSheet client={outcomeFor} onClose={() => setOutcomeFor(null)} onPick={(o) => { const c = outcomeFor!; setOutcomeFor(null); void setClientOutcome(c, o); }} />
            {renderLeadToast()}
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
      setAddSheet(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create client.');
    } finally {
      setBusy(false);
    }
  }

  // [LEAD-STATUS] Counts come from the FULL loaded list; the rendered list is the active-filter slice.
  const leadCounts = leadStatusCounts(clients);
  // [P36-6] Last message first by default (no message → after everyone with one); or by name; or most overdue.
  const lastAt = (c: ClientSummary): string => rows[c.id]?.lastMessageAt ?? '';
  const sorted = clients.slice().sort((a, b) =>
    sortBy === 'name' ? a.name.localeCompare(b.name)
      : sortBy === 'overdue' ? (rows[b.id]?.overduePromises ?? 0) - (rows[a.id]?.overduePromises ?? 0) || lastAt(b).localeCompare(lastAt(a))
        : lastAt(b).localeCompare(lastAt(a)) || a.name.localeCompare(b.name));
  const visibleClients = sorted.filter((c) => matchesLeadFilter(c, leadFilter));
  // [CLIENT-SEARCH] When a query is active, the list is the ranked search hits that ALSO match the
  // active status chip (search + filter combine). Below the min length, search is inactive.
  const search = searchClients(clients.map((c) => ({ ...c, aliases: rows[c.id]?.aliases ?? [] })), debouncedQuery);
  const visibleHits = search.active ? search.hits.filter((h) => matchesLeadFilter(h.client, leadFilter)) : [];
  /** [P36-7] Undo puts back EXACTLY what the change replaced — the status with its own changed-at, and the
   *  outcome (value, source, time) if a Done changed it. Never "still open": the going-quiet clock is untouched. */
  function undoLeadStatus(t: { clientId: string; prev: StatusSnapshot }): void {
    const c = clients.find((x) => x.id === t.clientId);
    setLeadToast(null);
    setOutcomeFor(null);
    if (!c) return;
    const restoreOutcome = (c.outcome ?? 'open') !== t.prev.outcome;
    const back = (x: ClientSummary): ClientSummary => ({ ...x, leadStatus: t.prev.leadStatus, leadStatusChangedAt: t.prev.leadStatusChangedAt, ...(restoreOutcome ? { outcome: t.prev.outcome, outcomeSource: t.prev.outcomeSource, outcomeChangedAt: t.prev.outcomeChangedAt } : {}) });
    setClients((list) => list.map((x) => (x.id === c.id ? back(x) : x)));
    setOpen((o) => (o && o.id === c.id ? back(o) : o));
    void clientsApi.restoreStatus(c.id, t.prev, restoreOutcome).then((ok) => {
      if (!ok) setLeadToast({ kind: 'error', message: 'Could not undo. Please try again.' });
      loadSuggestions();
    });
  }

  /** The status toast — an error, or the change with its Undo. [P36-7] Also on the phone's full-screen client page. */
  function renderLeadToast(): JSX.Element | null {
    if (!leadToast) return null;
    return (
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
    );
  }

  const needsSeeding = seeding !== null && !seeding.seeded;

  return (
    <AppShell
      view={view}
      onNavigate={navigate}
      needsSeeding={needsSeeding}
      badges={{ inventory: matchBadge }}
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
          {/* [P37] 80 / 95 / 100% of the allowance → a banner that opens Settings → Subscription. */}
          <UsageBanner api={usageApi} onOpenSubscription={openSubscription} />
          <HeroInsights api={heroApi} />
          <MoveSuggestions api={noteMoveApi} clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
          {/* [P34-3] the newest 3 on Today; the rest one tap away */}
          <ConfirmChitQueue api={promisesApi} captures={recallApi} kept={promisesApi} statusSuggestions={statusSuggestionsApi} limit={3} onSeeAll={() => setView('confirm')} />
        </>,
      )}

      {view === 'confirm' && (
        <>
          <h2 className="tov-screenhead" style={{ marginTop: 0 }}>To Confirm</h2>
          <ConfirmChitQueue api={promisesApi} captures={recallApi} kept={promisesApi} statusSuggestions={statusSuggestionsApi} standalone />
        </>
      )}

      {view === 'week' && gated(
        <>
          <MondayDigest api={mondayApi} onSetOutcome={async (id, choice) => { await clientsApi.setOutcome(id, choice); }} />
          <ConfirmChitQueue api={promisesApi} heading="Guesses to confirm" kept={promisesApi} />
        </>,
      )}

      {(view === 'find' || view === 'ask') && gated(<Ask api={recallApi} listen={speechListen} onOpenSubscription={openSubscription} />)}

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
        <Page testId="settings" label="Settings">
          <PageHeader title="Settings" />
          <Section>
            <ul className="ui-list">
              <ListRow title="Subscription" meta="Your plan, usage, and buying more usage" onOpen={() => navigate('subscription')} openLabel="Subscription" trailing={<span aria-hidden="true" className="ui-caption">›</span>} />
              <ListRow title="Account" meta="Your email, signing out, your data" onOpen={() => navigate('account')} openLabel="Account" trailing={<span aria-hidden="true" className="ui-caption">›</span>} />
            </ul>
          </Section>
          <Section title="Appearance"><ThemeToggle /></Section>
          <Section title="Time zone"><TimezoneSetting current={session.user.timezone} api={auth} /></Section>
          <Section title="Notifications"><NotificationSetup state={readPushState()} api={notificationApi} /></Section>
          <Section title="Tell clients you keep notes"><DisclosureLine /></Section>
        </Page>
      )}

      {/* [P37 → P39] Subscription: the plan, the trial or renewal date, the usage bar, "Buy more usage" right under
          it (an active subscriber only), and Manage billing. The one home of the top-up picker. */}
      {view === 'subscription' && (
        <Page testId="subscription" label="Subscription">
          <PageHeader title="Subscription" back={backTo('settings')} />
          <section id="subscription" aria-label="Subscription" className="ui-section">
            <Billing api={billingApi} />
            {/* [P11-1] a trial rep at 100% gets Subscribe now here → checkout, instead of a dead end. */}
            <UsageMeter
              api={usageApi}
              onSubscribe={startCheckout}
              onUpdateCard={() => void billingApi.portal().then((url) => { if (url) window.location.href = url; })}
              awaitingTopUp={awaitingTopUp}
              onTopUpSettled={() => {
                setAwaitingTopUp(false);
                try { const u = new URL(window.location.href); u.searchParams.delete('topup'); window.history.replaceState({}, '', `${u.pathname}${u.search}`); } catch { /* jsdom */ }
              }}
            />
          </section>
        </Page>
      )}

      {/* [P39] Account: who is signed in, Log out (moved off every page), and the rep's data. */}
      {view === 'account' && (
        <Page testId="account" label="Account">
          <PageHeader title="Account" back={backTo('settings')} />
          <Section title="Signed in as">
            <p className="ui-body" data-testid="account-email">{session.user.email}</p>
            <p className="ui-secondary">{session.user.emailVerified ? 'Email confirmed' : 'Email not confirmed yet'}</p>
            <div><Button onClick={onLogout}>Log out</Button></div>
          </Section>
          <Section title="Your data"><AccountControls api={accountApi} onDeleted={onLogout} /></Section>
        </Page>
      )}

      {view === 'clients' && (
        <div className={isDesktop ? 'tov-split' : undefined}>
          <div className={isDesktop ? 'tov-split__rail' : undefined}>
          {clientsAction ? (
            /* [P39] "New client from a chat" / "Import several chats" are sub-screens with a back to Clients. */
            <Page testId="clients-action" label={clientsAction === 'newFromChat' ? 'New client from a chat' : 'Import several chats'}>
              <PageHeader
                title={clientsAction === 'newFromChat' ? 'New client from a chat' : 'Import several chats'}
                back={{ label: 'Clients', onBack: () => { setClientsAction(null); setOnboardingImport(false); } }}
              />
              {clientsAction === 'newFromChat'
                ? <BulkImport
                    key="single" api={bulkImportApi} single onSubscribe={startCheckout} onOpenSubscription={openSubscription}
                    onOpenBookScan={() => { loadSeeding(); setClientsAction(null); setOnboardingImport(false); setView('bookscan'); }}
                    onClientReady={onboardingImport ? undefined : (id) => void openImportedClient(id)}
                  />
                : <BulkImport key="several" api={bulkImportApi} onSubscribe={startCheckout} onOpenSubscription={openSubscription} onOpenBookScan={() => setView('bookscan')} />}
            </Page>
          ) : (
          <Page testId="clients-page" label="Clients">
          {/* [P39] One primary action: "+ Add client" opens a sheet with the three ways in. */}
          <PageHeader
            title="Clients"
            action={<Button variant="primary" size="sm" data-tour="add-client" aria-haspopup="dialog" onClick={() => setAddSheet('menu')}>+ Add client</Button>}
          />
          {/* [P36-1] Capture lives inside a client; a chat for a client you don't have yet starts here. */}
          {(sharedContent || sharedContentB64) && (
            <div data-testid="shared-chat">
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

          <div className="ui-stack">
            {/* [CLIENT-SEARCH] One box searches name + alias + phone + email together. The value stays in React
                state and is matched in the browser — it is never put in the request URL. [P39-3] The sort is an
                icon button on the same row, opening a sheet. */}
            <SearchInput
              label="Search clients by name, alias, phone or email"
              placeholder="Search name, alias, phone or email"
              value={query}
              onChange={setQuery}
              trailing={<IconButton label="Sort clients" aria-haspopup="dialog" onClick={() => setSortSheet(true)}>⇅</IconButton>}
            />
            {/* [LEAD-STATUS] Filter chips with per-bucket counts; the active one is highlighted. */}
            <LeadStatusFilterBar filter={leadFilter} counts={leadCounts} onChange={setLeadFilter} />
          </div>

          {renderLeadToast()}

          {(search.active ? visibleHits.length === 0 : visibleClients.length === 0) ? (
            clients.length === 0 ? (
              <EmptyState
                data-testid="clients-empty"
                title="No clients yet."
                action={<Button variant="primary" onClick={() => setAddSheet('menu')}>+ Add client</Button>}
              >
                Add your first client from a WhatsApp chat, or by name.
              </EmptyState>
            ) : search.active ? (
              <EmptyState
                data-testid="clients-empty"
                title={`No clients match “${query.trim()}”.`}
                action={<Button data-testid="search-clear-empty" onClick={() => setQuery('')}>Clear search</Button>}
              />
            ) : (
              <EmptyState
                data-testid="clients-empty"
                title="No clients match this filter."
                action={leadFilter !== 'all' ? <Button onClick={() => setLeadFilter('all')}>Show all</Button> : undefined}
              />
            )
          ) : (
            <ul className="ui-list" data-testid="clients-list">
              {search.active
                ? visibleHits.map((h) => (
                    <ClientRow
                      key={h.client.id}
                      client={h.client}
                      onOpen={() => setOpen(h.client)}
                      onOpenStatus={() => setStatusSheetFor(h.client)}
                      match={{ field: h.field, value: h.value, ranges: h.ranges }}
                      summary={rows[h.client.id]}
                    />
                  ))
                : visibleClients.map((c) => (
                    <ClientRow key={c.id} client={c} summary={rows[c.id]} onOpen={() => setOpen(c)} onOpenStatus={() => setStatusSheetFor(c)} />
                  ))}
            </ul>
          )}

          <Sheet open={addSheet === 'menu'} onClose={() => setAddSheet(null)} title="Add a client">
            <div className="ui-stack ui-gap-1">
              <button type="button" className="ui-sheet__option" onClick={() => { setAddSheet(null); setClientsAction('newFromChat'); }}>
                <span>New client from a chat</span><span className="ui-sheet__hint">Choose a WhatsApp chat export. You confirm who it's with first.</span>
              </button>
              <button type="button" className="ui-sheet__option" onClick={() => { setAddSheet(null); setClientsAction('importSeveral'); }}>
                <span>Import several chats</span><span className="ui-sheet__hint">Add several clients at once from their chat exports.</span>
              </button>
              <button type="button" className="ui-sheet__option" onClick={() => setAddSheet('name')}>
                <span>Add by name only</span><span className="ui-sheet__hint">Start an empty client and add notes later.</span>
              </button>
            </div>
          </Sheet>
          <Sheet open={addSheet === 'name'} onClose={() => { setAddSheet(null); setError(null); }} title="Add by name only">
            <form onSubmit={(e) => void addClient(e)} className="ui-stack">
              <TextInput label="Client name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              {error && <p className="ui-secondary ui-danger" role="alert">{error}</p>}
              <ActionRow>
                <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>Add client</Button>
                <Button variant="text" onClick={() => { setAddSheet(null); setError(null); }}>Cancel</Button>
              </ActionRow>
            </form>
          </Sheet>
          <Sheet open={sortSheet} onClose={() => setSortSheet(false)} title="Sort clients">
            {/* [P36-6] Sort: last message (default), name, or most overdue promises. */}
            <div role="radiogroup" aria-label="Sort clients" className="ui-stack ui-gap-1">
              {SORT_OPTIONS.map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={sortBy === o.value} className="ui-sheet__option" onClick={() => { setSortBy(o.value); setSortSheet(false); }}>
                  <span>{o.label}{sortBy === o.value ? ' ✓' : ''}</span>
                </button>
              ))}
            </div>
          </Sheet>
          </Page>
          )}
          </div>
          {isDesktop && (
            <div className="tov-split__detail">
              {open ? (
                <ClientDetail client={open} clients={clients.map((c) => ({ id: c.id, name: c.name }))} onBack={() => setOpen(null)} onSubscribe={startCheckout} onOpenLeadSheet={() => setStatusSheetFor(open)} timeZone={session.user.timezone} billingStatus={billing?.status} onOpenClient={(id) => { const c = clients.find((x) => x.id === id); if (c) setOpen(c); }} initialImport={sharedFor && sharedFor.clientId === open.id ? sharedFor : undefined} onOpenSubscription={openSubscription} />
              ) : (
                <p style={{ color: 'var(--text-secondary)' }}>Select a client to open their book.</p>
              )}
            </div>
          )}
          <LeadStatusSheet client={statusSheetFor} suggestion={statusSheetFor ? suggestions.get(statusSheetFor.id) ?? null : null} onClose={() => setStatusSheetFor(null)} onPick={(s, outcome) => void changeLeadStatus(statusSheetFor!, s, { outcome })} />
            <OutcomeSheet client={outcomeFor} onClose={() => setOutcomeFor(null)} onPick={(o) => { const c = outcomeFor!; setOutcomeFor(null); void setClientOutcome(c, o); }} />
        </div>
      )}
      </ErrorBoundary>
      {tour && (
        <Tour
          mode={tour.mode}
          startStep={tour.start}
          api={tourApi}
          billing={billingApi}
          usage={usageApi}
          notifications={notificationApi}
          standalone={readPushState().standalone}
          onNavigate={(v) => { setOpen(null); setClientsAction(null); setView(v); }}
          onFinish={() => {
            // "Import your first chat" → New client from a chat; the Day-One Book Scan follows the import.
            setTour(null);
            setOnboardingImport(true);
            setClientsAction('newFromChat');
            setView('clients');
          }}
        />
      )}
    </AppShell>
  );
}

function ClientDetail({ client, clients = [], onBack, onSubscribe, onOpenLeadSheet, timeZone, billingStatus, onOpenClient, initialImport, onOpenSubscription }: { client: ClientSummary; clients?: Array<{ id: string; name: string }>; onBack: () => void; onSubscribe: (plan: Plan) => void; onOpenLeadSheet?: () => void; timeZone?: string; billingStatus?: string; onOpenClient?: (clientId: string) => void; /** [P36-2] a shared chat to import here, prefilled */ initialImport?: { content: string; contentB64: string }; /** [P37] */ onOpenSubscription?: () => void }): JSX.Element {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [pending, setPending] = useState<PendingRecording[]>([]);
  const [active, setActive] = useState<ActiveRecording | null>(null);
  const [recStartedAt, setRecStartedAt] = useState<number | null>(null); // [P36-5] the recorder's timer
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
  // [P36-5] the page's summaries (from the stored record) and the people around the deal.
  const [overview, setOverview] = useState<ClientOverview | null>(null);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [addOpen, setAddOpen] = useState(!!initialImport);
  const [capture, setCapture] = useState<'voice' | 'paste' | 'import' | null>(initialImport ? 'import' : null);

  const refresh = (): void => {
    void clientsApi.getPointers(client.id).then(setPointers);
    void clientPageApi.overview(client.id).then(setOverview);
    void clientsApi.getStakeholders(client.id).then(setStakeholders).catch(() => setStakeholders([]));
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
    setRecStartedAt(Date.now());
  }

  async function stopRec(): Promise<void> {
    if (!active) return;
    const blob = await active.stop();
    setActive(null);
    setRecStartedAt(null);
    await outbox.enqueue({ id: randomId(), clientId: client.id, blob, createdAt: Date.now() });
    hapticTick(); // the recording is captured — a commit
    setCapture(null);
    setAddOpen(false);
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
      setCapture(null);
      setAddOpen(false);
      refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save the message.');
    }
  }

  // [P36-5] The page's summaries + people count, and which sections the rep keeps open (saved with the account).
  const nowMs = Date.now();
  const { open: sections, toggle } = useSections(clientPageApi);
  const people = stakeholders.length;
  const thingsToKeep = pointers.pointers.length;
  const recording = active !== null;

  return (
    <main className="tov-clientpage" style={{ fontFamily: 'var(--font-sans)', padding: '1rem', maxWidth: 640, margin: '0 auto' }}>
      <button onClick={onBack} style={linkButton}>← Clients</button>
      <ClientHeader
        name={client.name}
        status={client.leadStatus}
        line={headerLine(overview, nowMs)}
        phone={phone}
        phoneEditor={
          <ClientPhoneField
            phone={phone}
            onSave={async (p) => {
              const updated = await clientsApi.setPhone(client.id, p);
              setPhone(updated ? updated.phone : p);
            }}
          />
        }
        onStatus={() => onOpenLeadSheet?.()}
        addOpen={addOpen}
        onAdd={() => { setAddOpen((o) => !o); setCapture(null); }}
      >
        {/* [P36-5] Add: every capture for this client starts here — voice note, a pasted message, a WhatsApp chat. */}
        {addOpen && !capture && (
          <div className="tov-addmenu" role="group" aria-label="Add to this client">
            <button type="button" onClick={() => { setCapture('voice'); void startRec(); }}>● Record voice note</button>
            <button type="button" onClick={() => setCapture('paste')}>Paste a message</button>
            <button type="button" onClick={() => setCapture('import')}>Import a WhatsApp chat</button>
          </div>
        )}
        {(capture === 'voice' || recording) && (
          <div className="tov-capture">
            {recording && recStartedAt !== null && <RecordingTimer startedAt={recStartedAt} maxMs={MAX_RECORDING_MS} />}
            {recording ? (
              <button onClick={() => void stopRec()} style={{ background: 'var(--claret-surface)', borderColor: 'var(--claret)', color: 'var(--claret)', fontWeight: 600 }}>■ Stop &amp; save</button>
            ) : (
              <button className="tov-primary" onClick={() => void startRec()}>● Record voice note</button>
            )}
          </div>
        )}
        {capture === 'paste' && (
          <form onSubmit={savePaste} className="tov-capture">
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="Paste a message (WhatsApp, email…)"
              aria-label="Paste a message"
              rows={3}
              style={{ width: '100%' }}
              dir="auto"
            />
            <button type="submit" disabled={!paste.trim()}>Save message</button>
          </form>
        )}
        {(capture === 'import' || showImport) && (
          <div className="tov-capture">
            <ImportChat
              clientId={client.id}
              api={clientsApi}
              onImported={() => {
                setShowImport(false);
                setCapture(null);
                setAddOpen(false);
                refresh();
              }}
              onOpenClient={onOpenClient}
              initialContent={initialImport?.content}
              initialContentBase64={initialImport?.contentB64}
              onOpenSubscription={onOpenSubscription}
            />
          </div>
        )}
        {status && <p style={{ color: 'var(--claret)' }}>{status}</p>}
        {pending.length > 0 && (
          <p style={{ color: 'var(--amber)' }}>
            {pending.length} recording(s) pending upload — they’re saved and will retry automatically.
          </p>
        )}
      </ClientHeader>

      <Accordion id="meeting" title="Before your next meeting" summary={thingsToKeep > 0 ? `${thingsToKeep} thing${thingsToKeep === 1 ? '' : 's'} to keep in mind` : null} open={sections.meeting} onToggle={() => toggle('meeting')}>
        {pointers.pointers.length > 0 && <PointersCard clientName={client.name} clientId={client.id} pointers={pointers.pointers} disclosure={pointers.disclosure} />}
        <button onClick={() => void clientsApi.getBrief(client.id).then(setBrief)} style={{ marginTop: '0.75rem' }}>Pre-meeting brief</button>
        {brief === LOCKED ? (
          <Locked onSubscribe={onSubscribe} status={billingStatus} />
        ) : (
          brief && <BriefPanel brief={brief} clientId={client.id} onChange={() => void clientsApi.getBrief(client.id).then(setBrief)} />
        )}
      </Accordion>

      <Accordion id="wants" title="What they want" summary={wantsSummary(overview)} open={sections.wants} onToggle={() => toggle('wants')}>
        {overview ? <WantsSection overview={overview} /> : <p className="tov-muted">Loading…</p>}
        <ClientInventory api={inventoryApi} clientId={client.id} />
      </Accordion>

      <Accordion id="promises" title="Promises" summary={promisesSummary(overview)} open={sections.promises} onToggle={() => toggle('promises')}>
        {overview ? <PromisesSection overview={overview} clientName={client.name} clientId={client.id} /> : <p className="tov-muted">Loading…</p>}
      </Accordion>

      <Accordion id="meetings" title="Meetings and viewings" summary={meetingsSummary(overview, timeZone)} open={sections.meetings} onToggle={() => toggle('meetings')}>
        {overview ? <MeetingsSection overview={overview} timeZone={timeZone} /> : <p className="tov-muted">Loading…</p>}
      </Accordion>

      <Accordion id="people" title="People involved" summary={people > 0 ? `${people} ${people === 1 ? 'person' : 'people'}` : null} open={sections.people} onToggle={() => toggle('people')}>
        <StakeholderMap clientId={client.id} api={{ getStakeholders: async () => stakeholders }} />
      </Accordion>

      <Accordion id="conversations" title="Conversations" summary={conversationsSummary(overview?.conversations ?? [])} open={sections.conversations} onToggle={() => toggle('conversations')}>
        <Conversations
          notes={notes}
          entries={overview?.conversations ?? []}
          ceilingNoteIds={ceilingNoteIds}
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
      </Accordion>
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
