import { useEffect, useRef, useState } from 'react';
import { Sheet, Button, ActionRow, TextInput, TextArea, Select } from '../ui/index.js';
import { RecordingTimer } from './page/RecordingTimer.js';
import { MAX_RECORDING_MS } from '../capture/recorder.js';
import { registerUnsavedSource } from '../pwa/unsavedWork.js';
import { INDUSTRY_OPTIONS } from '../access/RequestAccess.js';
import type { ClientSummary, CreateNewResult, NewClientInput, VoiceDraftResult } from './clientsClient.js';

/**
 * [P57 · owner] Clients → "+ New client": three ways in, none needing a chat export.
 *  1. Type it: a name (required), phone, company, industry (the sign-up form's list), role, and one Notes box. Save
 *     creates the client, and the note goes through the ordinary pasted-note path.
 *  2. Record a voice note: the rep speaks freely; Tovira transcribes it and shows a confirm step (what they said, the
 *     suggested name, company and phone). Nothing is created until the rep taps Create client; the recording then goes
 *     through the ordinary voice-note path. No name heard: "Who is this client?".
 *  3. Import a WhatsApp chat: the existing flow (and "Import several chats" beside it).
 * The same name or phone is a question, never a merge: "You already have Sara Khan. Add this to Sara Khan instead?".
 */
export interface NewClientApi {
  createNew(input: NewClientInput): Promise<CreateNewResult>;
  createPasteNote(clientId: string, text: string): Promise<unknown>;
  voiceDraft(blob: Blob): Promise<VoiceDraftResult>;
}
export type StartRecorder = () => Promise<{ ok: true; stop: () => Promise<Blob> } | { ok: false; message: string }>;

type Step = 'menu' | 'type' | 'recording' | 'transcribing' | 'confirm' | 'duplicate';
type Fields = { name: string; phone: string; company: string; industry: string; title: string };
const EMPTY: Fields = { name: '', phone: '', company: '', industry: '', title: '' };
const TITLES: Record<Step, string> = { menu: 'New client', type: 'Type it', recording: 'Record a voice note', transcribing: 'Record a voice note', confirm: 'Check the client', duplicate: 'Already a client' };
const NOTES_PROMPT = 'What do you know? Needs, budget, dates, what you promised.';
const INDUSTRIES = [{ value: '', label: 'Not set' }, ...INDUSTRY_OPTIONS.map((o) => ({ value: o.value as string, label: o.label }))];

export function NewClient({ open, onClose, api, startRecorder, onSaveRecording, onDone, onImportChat, onImportSeveral }: {
  open: boolean;
  onClose: () => void;
  api: NewClientApi;
  startRecorder: StartRecorder;
  /** The recording, into the outbox for this client: the ordinary voice-note upload. */
  onSaveRecording: (clientId: string, blob: Blob, recordedAt: number) => Promise<void>;
  /** Open the client: the new one, or the existing one the rep added this to. */
  onDone: (clientId: string, created: ClientSummary | null) => void;
  onImportChat: () => void;
  onImportSeveral: () => void;
}): JSX.Element {
  const [step, setStep] = useState<Step>('menu');
  const [source, setSource] = useState<'type' | 'voice'>('type');
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [notes, setNotes] = useState('');
  const [transcript, setTranscript] = useState('');
  const [nameHeard, setNameHeard] = useState(false);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string; message: string } | null>(null);
  const [created, setCreated] = useState<ClientSummary | null>(null); // the client exists; only the note is left to save
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recStartedAt, setRecStartedAt] = useState<number | null>(null);
  const stopRef = useRef<(() => Promise<Blob>) | null>(null);
  const recording = useRef<{ blob: Blob; at: number } | null>(null);

  // A recording not yet given to a client lives only in this sheet: an app update must ask, never reload over it.
  const unsaved = useRef(false);
  unsaved.current = step === 'recording' || step === 'transcribing' || ((step === 'confirm' || step === 'duplicate') && source === 'voice');
  useEffect(() => registerUnsavedSource(() => unsaved.current), []);

  function reset(): void {
    setStep('menu'); setFields(EMPTY); setNotes(''); setTranscript(''); setNameHeard(false); setDuplicate(null); setCreated(null); setError(null); setBusy(false);
    setRecStartedAt(null); stopRef.current = null; recording.current = null;
  }
  function close(): void { reset(); onClose(); }
  const set = (k: keyof Fields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));

  async function attach(clientId: string): Promise<boolean> {
    try {
      if (source === 'voice' && recording.current) await onSaveRecording(clientId, recording.current.blob, recording.current.at);
      if (source === 'type' && notes.trim()) await api.createPasteNote(clientId, notes);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the note.');
      return false;
    }
  }
  async function finish(client: ClientSummary): Promise<void> {
    setCreated(client);
    if (await attach(client.id)) { reset(); onDone(client.id, client); }
  }
  async function save(confirmDuplicate = false): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      if (created) { if (await attach(created.id)) { const c = created; reset(); onDone(c.id, c); } return; }
      const r = await api.createNew({ ...fields, name: fields.name.trim(), confirmDuplicate });
      if (r.ok) { await finish(r.client); return; }
      if (r.duplicate) { setDuplicate({ ...r.duplicate, message: r.message }); setStep('duplicate'); return; }
      setError(r.message);
    } finally {
      setBusy(false);
    }
  }
  async function addToExisting(): Promise<void> {
    if (!duplicate) return;
    setBusy(true);
    const d = duplicate;
    if (await attach(d.id)) { reset(); onDone(d.id, null); } else setBusy(false);
  }

  async function startVoice(): Promise<void> {
    setSource('voice');
    setError(null);
    setStep('recording');
    const r = await startRecorder();
    if (!r.ok) { setError(r.message); return; }
    stopRef.current = r.stop;
    setRecStartedAt(Date.now());
  }
  async function stopVoice(): Promise<void> {
    if (!stopRef.current) return;
    const blob = await stopRef.current();
    stopRef.current = null;
    setRecStartedAt(null);
    recording.current = { blob, at: Date.now() };
    await transcribe();
  }
  async function transcribe(): Promise<void> {
    if (!recording.current) return;
    setError(null);
    setStep('transcribing');
    const d = await api.voiceDraft(recording.current.blob);
    if (!d.ok) { setError(d.message); return; }
    setTranscript(d.transcript);
    setNameHeard(!!d.suggestion.name);
    setFields({ ...EMPTY, name: d.suggestion.name ?? '', company: d.suggestion.company ?? '', phone: d.suggestion.phone ?? '' });
    setStep('confirm');
  }

  const contactFields = (
    <>
      <TextInput label="Phone (with country code)" value={fields.phone} onChange={(e) => set('phone')(e.target.value)} inputMode="tel" autoComplete="off" />
      <TextInput label="Company" value={fields.company} onChange={(e) => set('company')(e.target.value)} autoComplete="off" />
      <Select label="Industry" value={fields.industry} options={INDUSTRIES} onChange={set('industry')} />
      <TextInput label="Role" value={fields.title} onChange={(e) => set('title')(e.target.value)} autoComplete="off" />
    </>
  );
  const errorLine = error && <p className="ui-secondary ui-danger" role="alert">{error}</p>;

  return (
    <Sheet open={open} onClose={close} title={TITLES[step]}>
      <div data-testid={`new-client-${step}`}>
        {step === 'menu' && (
          <div className="ui-stack ui-gap-1">
            <button type="button" className="ui-sheet__option" onClick={() => { setSource('type'); setStep('type'); }}>
              <span>Type it</span><span className="ui-sheet__hint">Name, contact and what you know.</span>
            </button>
            <button type="button" className="ui-sheet__option" onClick={() => void startVoice()}>
              <span>Record a voice note</span><span className="ui-sheet__hint">Say who you met and what they want. You check it before anything is saved.</span>
            </button>
            <button type="button" className="ui-sheet__option" onClick={() => { close(); onImportChat(); }}>
              <span>Import a WhatsApp chat</span><span className="ui-sheet__hint">Choose a WhatsApp chat export. You confirm who it's with first.</span>
            </button>
            <button type="button" className="ui-sheet__option" onClick={() => { close(); onImportSeveral(); }}>
              <span>Import several chats</span><span className="ui-sheet__hint">Add several clients at once from their chat exports.</span>
            </button>
          </div>
        )}

        {step === 'type' && (
          <form className="ui-stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <TextInput label="Name" value={fields.name} onChange={(e) => set('name')(e.target.value)} maxLength={80} required autoFocus autoComplete="off" disabled={!!created} />
            {contactFields}
            <TextArea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} dir="auto" placeholder={NOTES_PROMPT} />
            {errorLine}
            <ActionRow>
              <Button type="submit" variant="primary" loading={busy} disabled={!fields.name.trim()}>{created ? 'Try saving the note again' : 'Save'}</Button>
              <Button variant="text" onClick={close}>Cancel</Button>
            </ActionRow>
          </form>
        )}

        {(step === 'recording' || step === 'transcribing') && (
          <div className="ui-stack">
            {step === 'recording' && !error && <p className="ui-secondary">Say who you met, their company, and what they want.</p>}
            {recStartedAt !== null && <RecordingTimer startedAt={recStartedAt} maxMs={MAX_RECORDING_MS} />}
            {step === 'transcribing' && !error && <p className="ui-secondary" role="status">Transcribing…</p>}
            {errorLine}
            <ActionRow>
              {step === 'recording' && recStartedAt !== null && <Button variant="primary" onClick={() => void stopVoice()}>■ Stop</Button>}
              {step === 'transcribing' && error && recording.current && <Button variant="primary" onClick={() => void transcribe()}>Try again</Button>}
              <Button variant="text" onClick={close}>{recording.current ? 'Discard' : 'Cancel'}</Button>
            </ActionRow>
          </div>
        )}

        {step === 'confirm' && (
          <form className="ui-stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className="ui-stack ui-gap-1">
              <span className="ui-field__label">What you said</span>
              <p className="ui-secondary" dir="auto" data-testid="voice-transcript">{transcript || 'Nothing was heard in this recording.'}</p>
            </div>
            <TextInput label={nameHeard ? 'Name' : 'Who is this client?'} value={fields.name} onChange={(e) => set('name')(e.target.value)} maxLength={80} required autoComplete="off" disabled={!!created} />
            {contactFields}
            <p className="ui-secondary">Needs, dates and promises are read from your voice note once the client is created.</p>
            {errorLine}
            <ActionRow>
              <Button type="submit" variant="primary" loading={busy} disabled={!fields.name.trim()}>{created ? 'Try saving the recording again' : 'Create client'}</Button>
              <Button variant="text" onClick={close}>Discard</Button>
            </ActionRow>
          </form>
        )}

        {step === 'duplicate' && duplicate && (
          <div className="ui-stack">
            <p>{duplicate.message}</p>
            {errorLine}
            <ActionRow>
              <Button variant="primary" loading={busy} onClick={() => void addToExisting()}>Add to {duplicate.name}</Button>
              <Button onClick={() => void save(true)} disabled={busy}>Create new</Button>
            </ActionRow>
          </div>
        )}
      </div>
    </Sheet>
  );
}
