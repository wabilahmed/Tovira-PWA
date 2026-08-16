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
  sharedContent = '',
}: {
  seeding: SeedingStatus;
  clients: ClientSummary[];
  onCreateClient: (name: string) => Promise<ClientSummary>;
  importApi: ImportApi;
  onSeeded: () => void;
  onFallback: (kind: string) => void;
  /** A chat shared into the app (Android share-target) to prefill the import. */
  sharedContent?: string;
}): JSX.Element {
  // A shared chat jumps straight past the guide to the import step, prefilled.
  const [step, setStep] = useState<'guide' | 'import'>(sharedContent ? 'import' : 'guide');
  const [target, setTarget] = useState<ClientSummary | null>(clients[0] ?? null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (step === 'guide') {
    return <SeedingBanner status={seeding} onStartImport={() => setStep('import')} onFallback={onFallback} />;
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
    return (
      <section aria-label="Name the client">
        <h2>Who's this chat with?</h2>
        <form onSubmit={createAndSelect} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Client name"
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
      <ImportChat clientId={target.id} api={importApi} onImported={onSeeded} initialContent={sharedContent} />
    </section>
  );
}
