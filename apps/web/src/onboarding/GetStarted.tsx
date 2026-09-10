import { useState } from 'react';
import type { SeedingStatus } from './onboardingClient.js';
import type { ClientSummary } from '../clients/clientsClient.js';
import { SeedingBanner } from './SeedingBanner.js';
import { ImportChat, type ImportApi } from '../import/ImportChat.js';

/**
 * First-session flow (P5-3): guide → (create a client if needed) → import a chat →
 * hand off to the Book Scan. Never demands paste-based bulk entry.
 */
export function GetStarted({
  seeding,
  clients,
  onCreateClient,
  importApi,
  onSeeded,
  onFallback,
  onAddInventory,
  sharedContent = '',
  sharedContentB64 = '',
}: {
  seeding: SeedingStatus;
  clients: ClientSummary[];
  onCreateClient: (name: string) => Promise<ClientSummary>;
  importApi: ImportApi;
  onSeeded: () => void;
  onFallback: (kind: string) => void;
  /** Jump to the Inventory tab — a second, export-free way to seed (spec §11.6). */
  onAddInventory?: () => void;
  /** A chat shared into the app (Android share-target) to prefill the import — text… */
  sharedContent?: string;
  /** …or a shared file's bytes, base64 (a .zip export). */
  sharedContentB64?: string;
}): JSX.Element {
  // A shared chat (text or file) jumps straight past the guide to the import step, prefilled.
  const shared = Boolean(sharedContent || sharedContentB64);
  const [step, setStep] = useState<'guide' | 'import'>(shared ? 'import' : 'guide');
  // [IMPORT-PLACEMENT] A shared chat arrives with NO client context (nothing behind the share sheet),
  // so it must NOT assume a client — start with no target and force the picker below. The guided
  // onboarding path (not shared) still defaults to the first client, since the rep is already in a
  // client-context flow they can see.
  const [target, setTarget] = useState<ClientSummary | null>(shared ? null : (clients[0] ?? null));
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (step === 'guide') {
    return (
      <>
        <SeedingBanner status={seeding} onStartImport={() => setStep('import')} onFallback={onFallback} />
        {onAddInventory && (
          <p className="tov-seed-inv" style={{ color: 'var(--text-secondary)', marginTop: '1rem' }}>
            Or tell Tovira what you have to sell — a few items, no export needed.{' '}
            <button className="tov-link" onClick={onAddInventory}>Add inventory</button>
          </p>
        )}
      </>
    );
  }

  async function createAndSelect(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setTarget(await onCreateClient(newName.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the client.');
    } finally {
      setBusy(false);
    }
  }

  if (!target) {
    // [IMPORT-PLACEMENT] The client picker: choose an existing client (when any) OR create one
    // inline. Reached when a chat was shared with no client context — the file resolves to a client
    // the rep explicitly picks before anything is processed, never an assumed one.
    return (
      <section aria-label="Choose the client">
        <h2>Who's this chat with?</h2>
        {clients.length > 0 && (
          <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {clients.map((c) => (
              <button key={c.id} type="button" onClick={() => setTarget(c)} style={{ textAlign: 'left' }}>
                {c.name}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={createAndSelect} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={clients.length > 0 ? 'or add a new client' : 'Client name'}
            aria-label="Client name"
            style={{ flex: 1 }}
          />
          <button type="submit" disabled={busy || !newName.trim()}>Continue</button>
        </form>
        {error && <p role="alert" style={{ color: 'var(--claret)' }}>{error}</p>}
      </section>
    );
  }

  return (
    <section aria-label="Import for client">
      <h2>Import {target.name}'s chat</h2>
      <ImportChat clientId={target.id} api={importApi} onImported={onSeeded} initialContent={sharedContent} initialContentBase64={sharedContentB64} />
    </section>
  );
}
