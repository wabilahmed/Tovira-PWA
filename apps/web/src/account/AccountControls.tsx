import { useState } from 'react';

export interface AccountApi {
  exportData(): Promise<unknown | null>;
  deleteAccount(): Promise<boolean>;
}

/** Data trust & control (P5-4): export your data, or delete everything. Delete is
 *  guarded by an explicit confirmation — it's irreversible. */
export function AccountControls({ api, onDeleted }: { api: AccountApi; onDeleted: () => void }): JSX.Element {
  const [download, setDownload] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function doExport(): Promise<void> {
    setError(null);
    const data = await api.exportData();
    if (data == null) {
      setError('Could not export your data — please try again.');
      return;
    }
    setDownload('data:application/json,' + encodeURIComponent(JSON.stringify(data, null, 2)));
  }

  async function doDelete(): Promise<void> {
    setBusy(true);
    setError(null);
    const ok = await api.deleteAccount();
    setBusy(false);
    if (ok) onDeleted();
    else setError('Could not delete your account — please try again.');
  }

  return (
    <section aria-label="Your data">
      <h2 style={{ marginTop: 0 }}>Your data</h2>

      <p>
        <button onClick={() => void doExport()}>Export my data</button>{' '}
        {download && (
          <a href={download} download="tovira-export.json" data-testid="download-link">
            Download export
          </a>
        )}
      </p>

      <hr />

      <p style={{ color: 'var(--text-secondary)' }}>Deleting removes your account and all client data. This can't be undone.</p>
      {!confirming ? (
        <button onClick={() => setConfirming(true)} style={{ color: 'var(--claret)' }}>Delete my account</button>
      ) : (
        <div data-testid="delete-confirm" style={{ borderInlineStart: '2px solid var(--claret)', background: 'var(--claret-surface)', borderRadius: 'var(--radius-card)', padding: '0.75rem 1rem' }}>
          <strong>Are you sure? This is permanent.</strong>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button onClick={() => void doDelete()} disabled={busy} style={{ background: 'var(--claret)', borderColor: 'var(--claret)', color: 'var(--surface-base)', fontWeight: 600 }}>
              {busy ? 'Deleting…' : 'Yes, delete everything'}
            </button>
            <button onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}

      {error && <p role="alert" style={{ color: 'var(--claret)' }}>{error}</p>}
    </section>
  );
}
