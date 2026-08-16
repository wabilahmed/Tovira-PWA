import { useEffect, useState } from 'react';
import { AuthClient, type Session } from './auth/authClient.js';
import { ClientsClient, type ClientSummary, type NoteSummary, type Brief } from './clients/clientsClient.js';
import { OnboardingClient, type SeedingStatus } from './onboarding/onboardingClient.js';
import { BookScanClient } from './bookscan/bookScanClient.js';
import { GetStarted } from './onboarding/GetStarted.js';
import { BookScan } from './bookscan/BookScan.js';
import { ImportChat } from './import/ImportChat.js';
import { consumeSharedChat, idbSharedChatStore } from './pwa/sharedChat.js';
import { resumePendingNotes } from './capture/resume.js';
import { PromisesClient } from './promises/promisesClient.js';
import { PromisesTracker } from './promises/PromisesTracker.js';
import { ConfirmChitQueue } from './confirm/ConfirmChitQueue.js';
import { HeroClient } from './hero/heroClient.js';
import { HeroInsights } from './hero/HeroInsights.js';
import { ProactiveClient } from './proactive/proactiveClient.js';
import { Alerts } from './proactive/Alerts.js';
import { MeetingsClient } from './meetings/meetingsClient.js';
import { Meetings } from './meetings/Meetings.js';
import { BillingClient } from './billing/billingClient.js';
import { Billing } from './billing/Billing.js';
import { TrialIncentive } from './billing/TrialIncentive.js';
import { AccountClient } from './account/accountClient.js';
import { AccountControls } from './account/AccountControls.js';
import { CardsClient } from './cards/cardsClient.js';
import { CardScan } from './cards/CardScan.js';
import { ImagesClient } from './gallery/imagesClient.js';
import { Gallery } from './gallery/Gallery.js';
import { FollowUpDraft } from './followup/FollowUpDraft.js';
import { NotesTimeline } from './clients/NotesTimeline.js';
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
import { formatMonthYear, formatBody } from './format/dates.js';
import { AppShell } from './shell/AppShell.js';
import type { View } from './shell/nav.js';
import { useIsDesktop } from './shell/useIsDesktop.js';
import { Receipt } from './components/Receipt.js';
import { Capture } from './capture/Capture.js';
import { detectStandalone, type OnboardingState } from './onboarding/onboarding.js';
import { Outbox, type PendingRecording } from './capture/outbox.js';
import { IdbRecordingStore } from './capture/idbRecordingStore.js';
import { HttpUploader } from './capture/uploader.js';
import { requestMicrophone } from './capture/microphone.js';
import { startRecording, type ActiveRecording } from './capture/recorder.js';

const auth = new AuthClient();
const clientsApi = new ClientsClient();
const onboardingApi = new OnboardingClient();
const bookScanApi = new BookScanClient();
const promisesApi = new PromisesClient();
const heroApi = new HeroClient();
const proactiveApi = new ProactiveClient();
const meetingsApi = new MeetingsClient();
const billingApi = new BillingClient();
const accountApi = new AccountClient();
const cardsApi = new CardsClient();
const imagesApi = new ImagesClient();
const recallApi = new RecallClient();
const corpusApi = new CorpusClient();
const mondayApi = new MondayClient();
const ledgerApi = new LedgerClient();
const shareCardApi = new ShareCardClient();
const pushClient = new PushClient();

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
const outbox = new Outbox(new IdbRecordingStore(), new HttpUploader());

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
}

export function App(): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    // On load / refresh: ask the server who we are. Cookie → still logged in.
    auth
      .getSession()
      .then(setSession)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Centered>Loading…</Centered>;
  if (!session) return <LoginScreen onAuthed={setSession} />;

  return <ClientsScreen session={session} onLogout={() => void auth.logout().then(() => setSession(null))} />;
}

function ClientsScreen({ session, onLogout }: { session: Session; onLogout: () => void }): JSX.Element {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<ClientSummary | null>(null);
  const [view, setView] = useState<View>('clients');
  const [seeding, setSeeding] = useState<SeedingStatus | null>(null);
  const [sharedContent, setSharedContent] = useState('');
  const isDesktop = useIsDesktop();

  const loadSeeding = (): void => void onboardingApi.status().then(setSeeding);
  useEffect(loadSeeding, []);

  // A chat shared into the app via the Android share-target lands in IndexedDB
  // (stashed by the service worker); pick it up once and open seeding prefilled.
  useEffect(() => {
    void consumeSharedChat(idbSharedChatStore, (chat) => {
      setSharedContent(chat.text);
      setView('getstarted');
    });
  }, []);

  // Resume path (FLOWS-5): advance any note stuck awaiting transcription/extraction
  // on load, across all clients — so a voice note never stalls just because the
  // rep didn't reopen that client's screen.
  useEffect(() => {
    void resumePendingNotes(clientsApi);
  }, []);

  // Reload (with the current search) whenever the query changes — recents first.
  useEffect(() => {
    void clientsApi.list(query.trim() || undefined).then(setClients);
  }, [query]);

  // Mobile pushes the client detail full-screen; desktop keeps it beside the
  // list rail (the §8 split view), so the push only happens off desktop.
  if (open && !isDesktop) return <ClientDetail client={open} onBack={() => setOpen(null)} />;

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

  const needsSeeding = seeding !== null && !seeding.seeded;

  return (
    <AppShell
      view={view}
      onNavigate={setView}
      needsSeeding={needsSeeding}
      sidebarFooter={
        <span>
          {session.user.email}
          <br />
          <button onClick={onLogout} style={linkButton}>Log out</button>
        </span>
      }
    >
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
          sharedContent={sharedContent}
          onSeeded={() => {
            loadSeeding();
            setSharedContent('');
            setView('bookscan');
          }}
          onFallback={() => setView('clients')}
        />
      )}

      {view === 'capture' && (
        <Capture clients={clients} importApi={clientsApi} outbox={outbox} onCaptured={() => void clientsApi.list(query.trim() || undefined).then(setClients)} />
      )}

      {view === 'today' && (
        <>
          <HeroInsights api={heroApi} />
          <ConfirmChitQueue api={promisesApi} />
        </>
      )}

      {view === 'week' && (
        <>
          <MondayDigest api={mondayApi} />
          <ConfirmChitQueue api={promisesApi} heading="Guesses to confirm" />
        </>
      )}

      {view === 'ask' && <Ask api={recallApi} listen={speechListen} />}

      {view === 'promises' && <PromisesTracker api={promisesApi} />}

      {view === 'meetings' && <Meetings api={meetingsApi} clients={clients.map((c) => ({ id: c.id, name: c.name }))} />}

      {view === 'alerts' && (
        <>
          <Alerts api={proactiveApi} />
          <ConfirmChitQueue api={promisesApi} />
        </>
      )}

      {view === 'bookscan' && (
        <>
          <BookScan api={bookScanApi} />
          <ShareCard api={shareCardApi} referralCode={session.user.referralCode} />
        </>
      )}

      {view === 'ledger' && <Ledger api={ledgerApi} clients={clients.map((c) => ({ id: c.id, name: c.name }))} />}

      {view === 'settings' && (
        <>
          <header className="tov-screenhead" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
            <h2 style={{ marginTop: 0 }}>Settings</h2>
            <CorpusBadge api={corpusApi} />
          </header>
          <TrialIncentive api={billingApi} />
          <Billing api={billingApi} />
          <ThemeToggle />
          <NotificationSetup state={readPushState()} api={notificationApi} />
          <AccountControls api={accountApi} onDeleted={onLogout} />
        </>
      )}

      {view === 'clients' && (
        <div className={isDesktop ? 'tov-split' : undefined}>
          <div className={isDesktop ? 'tov-split__rail' : undefined}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <CorpusBadge api={corpusApi} />
            <small style={{ color: 'var(--text-secondary)' }}>
              {session.user.email} · <button onClick={onLogout} style={linkButton}>Log out</button>
            </small>
          </div>
          <h2 style={{ marginTop: 0 }}>Clients</h2>
          <form onSubmit={addClient} style={{ display: 'flex', gap: '0.5rem', margin: '1.5rem 0' }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New client name"
              aria-label="New client name"
              style={{ flex: 1 }}
            />
            <button type="submit" disabled={busy}>Add client</button>
          </form>
          {error && <p style={{ color: 'var(--claret)' }}>{error}</p>}

          <CardScan
            api={cardsApi}
            onCreateClient={async (n, phone) => {
              const created = await clientsApi.create(n, phone);
              setClients((prev) => [created, ...prev]);
              return created;
            }}
          />

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients…"
            aria-label="Search clients"
            style={{ width: '100%', marginBottom: '1rem' }}
          />

          {clients.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>
              {query.trim() ? `No clients match “${query.trim()}”.` : 'No clients yet. Add your first one above.'}
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {clients.map((c) => (
                <li key={c.id} style={{ borderBottom: '1px solid var(--hairline)' }}>
                  <button onClick={() => setOpen(c)} style={{ ...linkButton, display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 0', color: 'inherit' }}>
                    <div>{c.name}</div>
                    <small className="tov-stamp">on file since {formatMonthYear(c.createdAt)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          </div>
          {isDesktop && (
            <div className="tov-split__detail">
              {open ? (
                <ClientDetail client={open} onBack={() => setOpen(null)} />
              ) : (
                <p style={{ color: 'var(--text-secondary)' }}>Select a client to open their book.</p>
              )}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

function ClientDetail({ client, onBack }: { client: ClientSummary; onBack: () => void }): JSX.Element {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [pending, setPending] = useState<PendingRecording[]>([]);
  const [active, setActive] = useState<ActiveRecording | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [brief, setBrief] = useState<Brief | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [phone, setPhone] = useState<string | null>(client.phone);
  // Notes the server refused to extract because of the trial seeding ceiling. We
  // stop retrying them and show the non-scary ceiling state (no client-side math).
  const [ceilingNoteIds, setCeilingNoteIds] = useState<Set<string>>(new Set());

  const refresh = (): void => {
    void clientsApi.listNotes(client.id).then(async (list) => {
      setNotes(list);
      // Advance any notes through the pipeline: transcribe, then extract. Skip
      // notes already blocked by the ceiling — retrying just hits it again.
      const toTranscribe = list.filter((n) => n.status === 'pending_transcription');
      const toExtract = list.filter((n) => n.status === 'pending_extraction' && !ceilingNoteIds.has(n.id));
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
    void outbox.pending().then(setPending);
  };
  useEffect(() => {
    void outbox.flush().then(refresh);
  }, []);

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
    refresh();
  }

  async function savePaste(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!paste.trim()) return;
    setStatus(null);
    try {
      await clientsApi.createPasteNote(client.id, paste);
      setPaste('');
      refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save the message.');
    }
  }

  return (
    <main style={{ fontFamily: 'var(--font-sans)', padding: '2rem', maxWidth: 640, margin: '0 auto' }}>
      <button onClick={onBack} style={linkButton}>← Clients</button>
      <h1 style={{ marginBottom: '0.15rem' }}>{client.name}</h1>
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

      <button onClick={() => void clientsApi.getBrief(client.id).then(setBrief)}>Pre-meeting brief</button>
      {brief && <BriefPanel brief={brief} onChange={() => void clientsApi.getBrief(client.id).then(setBrief)} />}

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

      <Gallery clientId={client.id} api={imagesApi} />

      <h2 style={{ fontSize: '1rem', marginTop: '1.5rem' }}>Notes</h2>
      <NotesTimeline
        notes={notes}
        ceilingNoteIds={ceilingNoteIds}
        renderFollowUp={(noteId) => <FollowUpDraft noteId={noteId} api={clientsApi} phone={phone ?? undefined} />}
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


function LoginScreen({ onAuthed }: { onAuthed: (s: Session) => void }): JSX.Element {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ref = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('ref') ?? undefined : undefined;
      const session = mode === 'login' ? await auth.login(email, password) : await auth.signup(email, password, ref);
      onAuthed(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <form onSubmit={submit} style={{ display: 'grid', gap: '0.75rem', width: 300, background: 'var(--surface-raised)', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-card)', padding: '1.75rem' }}>
        <h1 style={{ margin: 0, letterSpacing: '-0.02em' }}>Tovira</h1>
        <p style={{ margin: '-0.4rem 0 0.4rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Your client book, kept.</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <p style={{ color: 'var(--claret)', margin: 0 }}>{error}</p>}
        <button type="submit" disabled={busy}>
          {mode === 'login' ? 'Log in' : 'Create account'}
        </button>
        <button type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} style={{ background: 'none', border: 'none', color: 'var(--brass)', cursor: 'pointer' }}>
          {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Log in'}
        </button>
      </form>
    </Centered>
  );
}

function BriefPanel({ brief, onChange }: { brief: Brief; onChange: () => void }): JSX.Element {
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
      {brief.openPromises.length > 0 && (
        <div style={briefSection}>
          <div className="tov-stamp">Open promises</div>
          <ul>{brief.openPromises.map((p) => <li key={p.id}>{p.text}{p.dueDate ? ` (due ${formatBody(p.dueDate)})` : p.dueRaw ? ` (${p.dueRaw})` : ''}</li>)}</ul>
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
            {brief.relatedNotes.map((n) => <Receipt key={n.noteId} quote={n.snippet} />)}
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

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ fontFamily: 'var(--font-sans)', display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      {children}
    </div>
  );
}
