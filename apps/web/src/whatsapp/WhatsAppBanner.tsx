import { useState } from 'react';
import { Button, Sheet } from '../ui/index.js';
import { useWhatsApp } from './useWhatsApp.js';
import { WhatsAppVerify } from './WhatsAppVerify.js';

/**
 * [P75 · owner] The top of Today, on every visit until the rep's WhatsApp is verified: "Verify your WhatsApp to send
 * chats straight to Tovira." with Verify now. It can't be dismissed (no close, no later). It goes for good once
 * verified, without a page reload (the shared status is checked on focus and while a code is out). Compact: one line
 * on desktop, two at most at 390px. Switched off for the rep: nothing.
 */
export function WhatsAppBanner(): JSX.Element | null {
  const wa = useWhatsApp();
  const [open, setOpen] = useState(false);
  if (!wa.status || wa.status.linked) return null;
  return (
    <>
      <div className="wa-banner" data-testid="whatsapp-banner" role="status">
        <span className="wa-banner__text">Verify your WhatsApp to send chats straight to Tovira.</span>
        <Button size="sm" variant="primary" onClick={() => { if (!wa.status?.awaitingConfirm) wa.reset(); setOpen(true); }}>Verify now</Button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Verify your WhatsApp">
        <WhatsAppVerify />
      </Sheet>
    </>
  );
}
