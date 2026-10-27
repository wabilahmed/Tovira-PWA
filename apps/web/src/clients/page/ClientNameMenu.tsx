import { useEffect, useRef, useState } from 'react';
import type { ClientSummary } from '../clientsClient.js';
import { Button, IconButton, Sheet, TextInput, Toast } from '../../ui/index.js';

/** [P49-5] The longest client name (the server refuses longer too). */
export const MAX_CLIENT_NAME = 80;
/** How long "Saved" and its Undo stay. */
export const RENAME_UNDO_MS = 5_000;

export type RenameResult =
  | { ok: true; client: ClientSummary; previousName: string }
  | { ok: false; reason: 'duplicate' | 'invalid' | 'restricted' | 'failed'; message: string };
export interface RenameApi { rename(id: string, name: string, confirmDuplicate: boolean): Promise<RenameResult> }

/** Trimmed and single-spaced, as the server stores it; or why it can't be saved. */
export function checkName(raw: string): { ok: true; name: string } | { ok: false; message: string } {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, message: 'A client name is required.' };
  if (name.length > MAX_CLIENT_NAME) return { ok: false, message: `Keep the name to ${MAX_CLIENT_NAME} characters or fewer.` };
  return { ok: true, name };
}

/**
 * [P49-5] The client page header's ⋯ menu with "Edit name": a Sheet with one field, prefilled, and Save. Another client
 * with that name is a warning the rep confirms ("Save anyway"), never a merge. "Saved" is a Toast with Undo for 5
 * seconds; Undo renames back. A client under an active erasure restriction (nameLocked) has no Edit name, so no menu.
 */
export function ClientNameMenu({ client, api, onRenamed }: { client: ClientSummary; api: RenameApi; onRenamed: (c: ClientSummary) => void }): JSX.Element | null {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [value, setValue] = useState(client.name);
  const [problem, setProblem] = useState<{ message: string; duplicate: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<{ previousName: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [menuOpen]);

  if (client.nameLocked && !undo) return null;

  function showSaved(previousName: string): void {
    if (timer.current) clearTimeout(timer.current);
    setUndo({ previousName });
    timer.current = setTimeout(() => setUndo(null), RENAME_UNDO_MS);
  }

  async function save(confirmDuplicate: boolean): Promise<void> {
    const checked = checkName(value);
    if (!checked.ok) { setProblem({ message: checked.message, duplicate: false }); return; }
    if (checked.name === client.name) { setSheetOpen(false); return; }
    setBusy(true);
    const res = await api.rename(client.id, checked.name, confirmDuplicate);
    setBusy(false);
    if (!res.ok) { setProblem({ message: res.message, duplicate: res.reason === 'duplicate' }); return; }
    setSheetOpen(false);
    setProblem(null);
    onRenamed(res.client);
    showSaved(res.previousName);
  }

  async function undoRename(): Promise<void> {
    if (!undo) return;
    if (timer.current) clearTimeout(timer.current);
    const back = undo.previousName;
    setUndo(null);
    const res = await api.rename(client.id, back, true); // back to the name it had: never a duplicate warning
    if (res.ok) onRenamed(res.client);
  }

  return (
    <>
      {!client.nameLocked && (
        <div className="ui-menu" ref={menuRef}>
          <IconButton label="More actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            <span aria-hidden="true">⋯</span>
          </IconButton>
          {menuOpen && (
            <div className="ui-menu__list" role="menu" aria-label={`${client.name}: more actions`}>
              <button type="button" role="menuitem" className="ui-menu__item" onClick={() => { setMenuOpen(false); setValue(client.name); setProblem(null); setSheetOpen(true); }}>
                Edit name
              </button>
            </div>
          )}
        </div>
      )}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Edit name">
        <form className="ui-stack ui-gap-3" onSubmit={(e) => { e.preventDefault(); void save(false); }}>
          <TextInput label="Client name" value={value} autoComplete="off" dir="auto" onChange={(e) => { setValue(e.target.value); setProblem(null); }} />
          {problem && <p className="ui-secondary" role="alert" data-testid="rename-problem">{problem.message}</p>}
          {problem?.duplicate ? (
            <Button variant="primary" block loading={busy} onClick={() => void save(true)}>Save anyway</Button>
          ) : (
            <Button variant="primary" block type="submit" loading={busy}>Save</Button>
          )}
        </form>
      </Sheet>
      {undo && <Toast data-testid="rename-toast" action={<Button variant="text" size="sm" onClick={() => void undoRename()}>Undo</Button>}>Saved</Toast>}
    </>
  );
}
