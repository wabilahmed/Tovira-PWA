import { useEffect, useRef, useState } from 'react';
import type { ClientSummary } from '../clients/clientsClient.js';
import { requestMicrophone } from './microphone.js';
import { startRecording, type ActiveRecording } from './recorder.js';
import type { Outbox } from './outbox.js';
import { ImportChat, type ImportApi } from '../import/ImportChat.js';
import { hapticTick } from '../haptics.js';

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
}

/**
 * The Capture screen (board §1j, P1). Pick the client, then record a voice note
 * or import a chat export. A recording is kept on the device and uploads on its
 * own — never lost. The record control is the app's one claret "can't be
 * replayed" action; the timer is mono.
 */
export function Capture({
  clients,
  importApi,
  outbox,
  onCaptured,
}: {
  clients: ClientSummary[];
  importApi: ImportApi;
  outbox: Outbox;
  onCaptured?: () => void;
}): JSX.Element {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [mode, setMode] = useState<'voice' | 'import'>('voice');
  const [active, setActive] = useState<ActiveRecording | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (clients.length > 0 && !clients.some((c) => c.id === clientId)) setClientId(clients[0]!.id);
  }, [clients, clientId]);

  const refreshPending = (): void => void outbox.pending().then((p) => setPending(p.length));
  useEffect(refreshPending, []);

  async function start(): Promise<void> {
    setStatus(null);
    if (!clientId) { setStatus('Add a client first, then capture a note for them.'); return; }
    const mic = await requestMicrophone();
    if (!mic.granted || !mic.stream) { setStatus(mic.guidance ?? 'Microphone unavailable.'); return; }
    setActive(startRecording(mic.stream));
    setElapsed(0);
    timer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  }

  async function stop(): Promise<void> {
    if (!active) return;
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    const blob = await active.stop();
    setActive(null);
    await outbox.enqueue({ id: randomId(), clientId, blob, createdAt: Date.now() });
    hapticTick(); // note saved — kept on the device, never lost
    refreshPending();
    onCaptured?.();
  }

  const clientName = clients.find((c) => c.id === clientId)?.name;

  return (
    <section aria-label="Capture">
      <header className="tov-screenhead">
        <h2 style={{ marginTop: 0 }}>Capture</h2>
        <div className="tov-screenmeta">a recording is never lost</div>
      </header>

      {clients.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>Add a client first — every capture is filed under one.</p>
      ) : (
        <>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', marginBottom: '1rem' }}>
            For
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Capture client" disabled={!!active}>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>

          <div role="tablist" aria-label="Capture mode" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <button type="button" role="tab" aria-selected={mode === 'voice'} className={mode === 'voice' ? 'tov-primary' : undefined} onClick={() => setMode('voice')} disabled={!!active}>Voice note</button>
            <button type="button" role="tab" aria-selected={mode === 'import'} className={mode === 'import' ? 'tov-primary' : undefined} onClick={() => setMode('import')} disabled={!!active}>Import chat</button>
          </div>

          {mode === 'voice' ? (
            <div className="tov-card" style={{ textAlign: 'center' }}>
              <div className="tov-mono" style={{ fontSize: '2rem', color: active ? 'var(--claret)' : 'var(--text-secondary)' }}>{mmss(elapsed)}</div>
              {active ? (
                <button type="button" onClick={() => void stop()} style={{ marginTop: '0.75rem', background: 'var(--claret)', borderColor: 'var(--claret)', color: 'var(--surface-base)', fontWeight: 600 }}>
                  Tap to stop
                </button>
              ) : (
                <button type="button" className="tov-primary" onClick={() => void start()} style={{ marginTop: '0.75rem' }}>
                  Record{clientName ? ` for ${clientName}` : ''}
                </button>
              )}
              <p style={{ color: 'var(--text-secondary)', marginBottom: 0 }}>Kept on your device until it uploads. Never lost.</p>
            </div>
          ) : (
            <ImportChat clientId={clientId} api={importApi} onImported={() => { refreshPending(); onCaptured?.(); }} />
          )}
        </>
      )}

      {status && <p role="alert" style={{ color: 'var(--claret)' }}>{status}</p>}
      {pending > 0 && (
        <p className="tov-stamp" style={{ marginTop: '1rem' }}>{pending} recording{pending === 1 ? '' : 's'} waiting for signal · uploads on its own</p>
      )}
    </section>
  );
}
