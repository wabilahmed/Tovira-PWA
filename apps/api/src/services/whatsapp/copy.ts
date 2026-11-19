/**
 * [P67 · owner] What Tovira replies on WhatsApp. Essential replies only (owner, 9 Nov: Meta charges for replies past
 * 1,000 a month): "Got your chat" with the confirm link, and the refusals. No "Done" message; the app shows it.
 * [P79 · owner] "Linked" is sent now (a rep who sent the code and heard nothing back thought it had failed). No em-dashes.
 */
export const EXPORT_STEPS = 'In the chat, tap ⋮ › More › Export chat (Android) or the contact’s name › Export chat (iPhone), choose Without media, then send the file here.';

export const REPLY = {
  notLinked: 'This number isn’t linked to a Tovira account. Link it in Tovira › Settings.',
  notAnExport: `That doesn’t look like a WhatsApp chat export. ${EXPORT_STEPS}`,
  help: `Send Tovira an exported chat file. ${EXPORT_STEPS}`,
  /** Something Meta couldn't pass on (it may be a .zip from an iPhone): the in-app upload always works. */
  unsupported: `That file didn’t come through. ${EXPORT_STEPS} If it still doesn’t arrive, upload it in Tovira instead: open the client and tap Import chat.`,
  /** [P79 · owner] wording */
  tooLarge: 'That file is too big. Export the chat Without media and send it again.',
  /** [P79 · owner] after the right code arrives from the number being linked */
  linked: 'Linked. You can now send chat exports to this number.',
  couldNotDownload: 'Tovira couldn’t download that file. Send it again in a minute.',
  wrongCode: 'That code isn’t right or has expired. Get a new one in Tovira › Settings › Send chats on WhatsApp.',
  /** [P75] A code from a different number than the rep entered: nothing is linked until they confirm it in the app. */
  confirmInApp: 'This isn’t the number you entered in Tovira. Open Tovira to confirm you want to use this one.',
  tooMany: 'You’ve sent a lot of chats in a short time. Wait an hour, then send the rest.',
  inactive: (status: string, appUrl: string): string =>
    status === 'trial_expired' || status === 'none'
      ? `Your Tovira trial has ended, so Tovira can’t analyse chats right now. Choose a plan: ${appUrl}/app?view=subscription`
      : `Tovira can’t analyse chats right now because your plan isn’t active. Check it here: ${appUrl}/app?view=subscription`,
  gotChat: (name: string | null, link: string): string =>
    `Got your chat${name ? ` with ${name}` : ''}. Tap to confirm who it’s with: ${link}`,
} as const;
