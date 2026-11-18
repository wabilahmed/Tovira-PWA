import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/index.js';
import { useWhatsApp } from './useWhatsApp.js';
import { WhatsAppVerify } from './WhatsAppVerify.js';

/**
 * [P75 · owner] The first sign-in step (after the invite, or from the invite email's "Verify your WhatsApp"): verify
 * now, or Do it later (the Today banner and Settings → WhatsApp stay until it is done). Skipped when WhatsApp is
 * switched off for the rep or already verified; closes by itself once verified.
 */
export function WhatsAppFirstStep({ onDone }: { onDone: () => void }): JSX.Element | null {
  const wa = useWhatsApp();
  const done = useRef(false);
  const finish = (): void => { if (!done.current) { done.current = true; onDone(); } };
  const skip = wa.status === null || !!wa.status?.linked;
  useEffect(() => { if (skip) finish(); });
  if (wa.status === undefined || skip) return null;
  // On the page itself (like the sheets), so the app's bottom bar never shows through.
  return createPortal(
    <div className="wa-first" data-testid="whatsapp-first-step" role="dialog" aria-modal="true" aria-labelledby="wa-first-title">
      <div className="wa-first__card ui-card ui-stack ui-gap-4">
        <h1 id="wa-first-title" className="ui-title" style={{ margin: 0 }}>Verify your WhatsApp</h1>
        <p className="ui-secondary" style={{ margin: 0 }}>Then you can send chats straight to Tovira from WhatsApp. One message from your phone proves the number is yours.</p>
        <WhatsAppVerify />
        <div><Button onClick={finish}>Do it later</Button></div>
      </div>
    </div>,
    document.body,
  );
}
