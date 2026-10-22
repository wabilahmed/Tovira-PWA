import { useState } from 'react';
import { ActionRow, Banner, Button, TextArea } from '../../ui/index.js';

export interface AddNoteApi { create(clientId: string, statement: string): Promise<'held' | 'paused' | 'failed'> }

/**
 * [P39-7] "Add a note" on the client's Add menu — what Ask's "Remember that…" used to do. The note is HELD: it
 * waits in Needs your answer and becomes a fact only when the rep confirms it (the Ask-capture governance: the
 * receipt is the rep's own words; reject keeps the log; 14-day expiry).
 */
export function AddNote({ clientId, clientName, api, onOpenSubscription }: { clientId: string; clientName: string; api: AddNoteApi; onOpenSubscription?: () => void }): JSX.Element {
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'held' | 'paused' | 'failed'>('idle');
  return (
    <form
      className="tov-capture ui-stack ui-gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setState('saving');
        void api.create(clientId, text.trim()).then((r) => {
          setState(r);
          if (r === 'held') setText('');
        });
      }}
    >
      <TextArea label="Add a note" value={text} onChange={(e) => setText(e.target.value)} rows={3} dir="auto" placeholder={`Something to remember about ${clientName}`} />
      <p className="ui-caption">You confirm it in Needs your answer before Tovira treats it as a fact.</p>
      <ActionRow><Button type="submit" variant="primary" loading={state === 'saving'} disabled={!text.trim()}>Save the note</Button></ActionRow>
      {state === 'held' && <p role="status" className="ui-secondary" data-testid="note-held">Saved. Confirm it in Needs your answer.</p>}
      {state === 'paused' && (
        <Banner tone="warning" actions={onOpenSubscription && <Button size="sm" onClick={onOpenSubscription}>Buy more usage</Button>}>
          AI is paused for your account, so new notes can't be read right now.
        </Banner>
      )}
      {state === 'failed' && <p role="alert" className="ui-secondary ui-danger">Couldn't save the note. Try again.</p>}
    </form>
  );
}
