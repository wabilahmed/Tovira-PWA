import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { TourApi } from './tourClient.js';
import type { View } from '../shell/nav.js';
import type { AllowanceStatus } from '../usage/allowanceClient.js';
import type { Entitlement } from '../billing/billingClient.js';
import { PLANS } from '../billing/plans.js';
import { usageLabel } from '../usage/UsageMeter.js';
import { ExportSteps, detectPlatform, type NavigatorLike } from '../onboarding/exportSteps.js';
import { ReceiptThread, ReceiptsProvider } from '../receipts/ReceiptThread.js';
import type { ReceiptsApi, ReceiptSource } from '../receipts/receiptsClient.js';
import { formatBody } from '../format/dates.js';

/**
 * [P37] The required first-login tour: nine short steps (about 75 seconds of reading) through the parts of
 * Tovira that matter, ending with the rep importing their first real chat. There is no Skip and no Close —
 * only Back and Next (Escape does nothing). Progress is saved on the account at every step, so a reload or
 * another device resumes where the rep was; finishing is recorded server-side. A replay ("Take the tour
 * again") shows the same steps and writes nothing.
 *
 * Where the real element is on screen (a nav tab, "New client from a chat", Subscribe / Buy more usage) it is
 * spotlit with the rest dimmed; otherwise the card sits centred — it never points at nothing. Screens a new
 * rep can't have yet (a client's page, a receipt, a To Confirm card) are shown as clearly labelled examples
 * built from static content: the tour never creates clients, notes or facts. The plan step uses the rep's
 * REAL trial date and usage, and prices from the same config the Subscription screen uses.
 */
export const TOUR_STEP_COUNT = 9;

export interface TourProps {
  mode: 'required' | 'replay';
  startStep?: number;
  api: Pick<TourApi, 'saveStep' | 'complete'>;
  billing: { status(): Promise<Entitlement | null> };
  usage: { status(): Promise<AllowanceStatus | null> };
  notifications: { enable(): Promise<unknown> };
  /** Show the screen a step talks about (so its real element can be spotlit). */
  onNavigate: (view: View) => void;
  /** "Import your first chat": open "New client from a chat". */
  onFinish: () => void;
  /** For tests: the device. */
  nav?: NavigatorLike;
  /** Already installed to the home screen. */
  standalone?: boolean;
  now?: number;
}

const DAY = 86_400_000;

interface StepDef {
  title: string;
  /** Spotlight: the first of these selectors that is on screen. */
  spot?: string[];
  /** [P46-6] A second spotlight on the same step (step 8: More, where The Ledger is). */
  spot2?: string[];
  view?: View;
  body: ReactNode;
}

export function Tour(props: TourProps): JSX.Element {
  const { mode, api, onNavigate, onFinish } = props;
  const [i, setI] = useState(() => Math.min(Math.max(props.startStep ?? 0, 0), TOUR_STEP_COUNT - 1));
  const [ent, setEnt] = useState<Entitlement | null>(null);
  const [usage, setUsage] = useState<AllowanceStatus | null>(null);
  const [notif, setNotif] = useState<'ask' | 'on' | 'later'>('ask');
  const [home, setHome] = useState<'ask' | 'later'>('ask');
  const cardRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    void props.billing.status().then(setEnt).catch(() => undefined);
    void props.usage.status().then(setUsage).catch(() => undefined);
  }, []);

  const steps = useMemo(() => buildSteps({ ent, usage, nav: props.nav, standalone: props.standalone ?? false, now: props.now ?? Date.now(), notif, home, setNotif, setHome, enable: props.notifications.enable }), [ent, usage, notif, home]);
  const step = steps[i]!;
  const last = i === TOUR_STEP_COUNT - 1;

  // Save progress on the account (required tour only), and show the screen the step talks about.
  useEffect(() => {
    if (mode === 'required') void api.saveStep(i);
    if (step.view) onNavigate(step.view);
    titleRef.current?.focus();
  }, [i]);

  const rect = useSpotlight(step.spot, i);
  const rect2 = useSpotlight(step.spot2, i);

  function next(): void { if (!last) setI((n) => n + 1); }
  function back(): void { if (i > 0) setI((n) => n - 1); }
  async function finish(): Promise<void> {
    if (mode === 'required') await api.complete();
    onFinish();
  }

  // Focus stays in the card: Tab / Shift+Tab cycle inside it; Enter (not on a control) is Next; Escape is a no-op.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'Enter') {
      const tag = (e.target as HTMLElement).tagName;
      if (tag !== 'BUTTON' && tag !== 'A' && tag !== 'INPUT') { e.preventDefault(); if (last) void finish(); else next(); }
      return;
    }
    if (e.key !== 'Tab' || !cardRef.current) return;
    const focusables = [...cardRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])')];
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const end = focusables[focusables.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) { e.preventDefault(); end.focus(); }
    else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
  }

  // Portalled to <body>: above the tab bar and outside the screen's own stacking context.
  return createPortal(
    <div className="tov-tour" data-testid="tour">
      {/* Dims the app and takes its taps: the tour is required. */}
      <div className="tov-tour__block" aria-hidden="true" />
      {rect && <div className="tov-tour__spot" aria-hidden="true" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />}
      {rect2 && <div className="tov-tour__spot" data-testid="tour-spot-2" aria-hidden="true" style={{ top: rect2.top - 6, left: rect2.left - 6, width: rect2.width + 12, height: rect2.height + 12 }} />}
      <div
        ref={cardRef}
        className={`tov-tour__card${rect ? ' tov-tour__card--with-spot' : ''}${rect && rect.top > window.innerHeight / 2 ? ' tov-tour__card--top' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tov-tour-title"
        aria-describedby="tov-tour-body"
        data-spotlight={rect ? 'on' : 'none'}
        onKeyDown={onKeyDown}
      >
        <p className="tov-tour__count" aria-live="polite" data-testid="tour-count">Step {i + 1} of {TOUR_STEP_COUNT}</p>
        <h2 id="tov-tour-title" ref={titleRef} tabIndex={-1} className="tov-tour__title">{step.title}</h2>
        <div id="tov-tour-body" className="tov-tour__body">{step.body}</div>
        <div className="tov-tour__nav">
          <button type="button" onClick={back} disabled={i === 0}>Back</button>
          {last
            ? <button type="button" className="tov-primary" onClick={() => void finish()}>Import your first chat</button>
            : <button type="button" className="tov-primary" onClick={next}>Next</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The spotlight's box: the first selector whose element is really on screen; else null (a centred card). */
function useSpotlight(selectors: string[] | undefined, key: number): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    const find = (): void => {
      let found: DOMRect | null = null;
      for (const sel of selectors ?? []) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const onScreen = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
        if (onScreen) { found = r; break; }
      }
      setRect(found);
    };
    // The step may have just switched the screen: look after it has rendered, and again on resize / scroll.
    const t = setTimeout(find, 60);
    find();
    window.addEventListener('resize', find);
    window.addEventListener('scroll', find, true);
    return () => { clearTimeout(t); window.removeEventListener('resize', find); window.removeEventListener('scroll', find, true); };
  }, [key]);
  return rect;
}

function Example({ children }: { children: ReactNode }): JSX.Element {
  return (
    <figure className="tov-tour__example" aria-label="Example">
      <figcaption className="tov-tour__example-tag">Example</figcaption>
      {children}
    </figure>
  );
}

/** A static receipt for the example — never fetched, never stored. */
const EXAMPLE_RECEIPT: ReceiptSource = {
  kind: 'chat', noteId: null, repKnown: true, hasMore: false,
  bubbles: [
    { sender: 'Sara Khan', side: 'other', at: '2026-05-07T11:10', text: 'Can you send the revised proposal?', source: false },
    { sender: 'You', side: 'rep', at: '2026-05-07T11:15', text: "Sure, I'll send it tomorrow.", source: true },
  ],
};
const exampleReceipts: ReceiptsApi = { source: async () => EXAMPLE_RECEIPT, thread: async () => EXAMPLE_RECEIPT };

const HOME_STEPS = {
  ios: 'In Safari, tap Share, then Add to Home Screen.',
  android: 'In Chrome, tap ⋮, then Install app (or Add to Home screen).',
} as const;

function buildSteps(c: {
  ent: Entitlement | null;
  usage: AllowanceStatus | null;
  nav?: NavigatorLike;
  standalone: boolean;
  now: number;
  notif: 'ask' | 'on' | 'later';
  home: 'ask' | 'later';
  setNotif: (v: 'ask' | 'on' | 'later') => void;
  setHome: (v: 'ask' | 'later') => void;
  enable: () => Promise<unknown>;
}): StepDef[] {
  const subscribed = c.ent?.status === 'active';
  const platform = detectPlatform(c.nav);
  return [
    {
      title: 'Welcome to Tovira',
      body: <p>Tovira remembers your clients from your WhatsApp chats and voice notes. Every answer shows the message it came from.</p>,
    },
    {
      title: 'Your clients',
      view: 'clients',
      spot: ['[data-tour="add-client"]', '[data-tour="nav-clients"]'],
      body: (
        <>
          {/* [P39-3] "New client from a chat" now sits behind "+ Add client". */}
          <p><strong>Add client</strong> → <strong>New client from a chat</strong>. Export first:</p>
          <ExportSteps nav={c.nav} />
        </>
      ),
    },
    {
      title: "A client's page",
      body: (
        <>
          <p>Each client has a page. <strong>Add</strong> takes a voice note, a pasted message or a chat. Set its status: Warm, Cold or Done.</p>
          <Example>
            <div className="tov-tour__mock">
              <div className="tov-tour__mock-head"><strong>Sara Khan</strong> <span className="lead-pill lead-pill--warm">Warm ▾</span> <span className="tov-tour__mock-add">+ Add</span></div>
              <div className="tov-tour__mock-row"><span>What they want</span><small>Renewal in June · wants a lower excess · decides with her partner</small></div>
              <div className="tov-tour__mock-row"><span>Promises</span><small>1 open</small></div>
              <div className="tov-tour__mock-row"><span>Conversations</span><small>1 WhatsApp chat</small></div>
            </div>
          </Example>
        </>
      ),
    },
    {
      title: 'Every fact shows its source',
      body: (
        <>
          <p>Tap any fact to see the exact message.</p>
          <Example>
            <p className="tov-tour__fact"><span className="tov-stamp">You promised</span> send the revised proposal</p>
            <ReceiptsProvider api={exampleReceipts}><ReceiptThread compact={false} refInfo={{ quote: "Sure, I'll send it tomorrow." }} /></ReceiptsProvider>
          </Example>
        </>
      ),
    },
    {
      title: 'To Confirm',
      body: (
        <>
          <p>When Tovira isn&apos;t sure, it asks. Nothing changes until you tap Confirm.</p>
          <Example>
            <div className="tov-confirm-chit">
              <p style={{ margin: '0 0 var(--space-2)' }}><strong>Sara Khan</strong> : send the revised proposal by Thursday?</p>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}><span className="tov-tour__fake-btn">Confirm</span><span className="tov-tour__fake-btn">Not right</span></div>
            </div>
          </Example>
        </>
      ),
    },
    {
      title: 'Today',
      view: 'today',
      spot: ['[data-tour="nav-today"]'],
      body: <p>Your plan for the day: what&apos;s due, who&apos;s waiting, and what needs your check.</p>,
    },
    {
      // [P39-7] Ask became Find: fixed questions, answered from the rep's clients' messages.
      title: 'Find',
      view: 'find',
      spot: ['[data-tour="nav-find"]'],
      body: (
        <>
          <p>Tap a question to see the answer from your clients&apos; messages.</p>
          <Example>
            <ul className="ui-list">
              {['Missed promises', 'Due this week', "Who hasn't replied in 2 weeks"].map((q) => (
                <li key={q} className="ui-row"><span className="ui-row__main"><span className="ui-row__title">{q}</span></span><span aria-hidden="true" className="ui-caption">›</span></li>
              ))}
            </ul>
          </Example>
        </>
      ),
    },
    {
      title: 'Your plan and settings',
      view: 'settings',
      spot: subscribed ? ['[data-tour="buy-more"]'] : ['[data-tour="subscribe"]'],
      spot2: ['[data-tour="nav-more"]'], // [P46-6] More → The Ledger
      body: <PlanStep ent={c.ent} usage={c.usage} now={c.now} />,
    },
    {
      title: 'Get set up, then start',
      view: 'clients',
      body: (
        <>
          <div className="tov-tour__setup">
            <strong>Add Tovira to your home screen</strong>
            {c.standalone ? <p>It&apos;s already there.</p> : c.home === 'later' ? <p className="tov-muted">You can do it any time.</p> : (
              <>
                {platform === 'unknown'
                  ? <ul><li>On iPhone: {HOME_STEPS.ios}</li><li>On Android: {HOME_STEPS.android}</li></ul>
                  : <p>{HOME_STEPS[platform]}</p>}
                <button type="button" className="tov-link" onClick={() => c.setHome('later')}>Not now</button>
              </>
            )}
          </div>
          <div className="tov-tour__setup">
            <strong>Turn on notifications</strong>
            {c.notif === 'on' ? <p>Done.</p> : c.notif === 'later' ? <p className="tov-muted">You can turn them on in Settings.</p> : (
              <>
                <p>For reminders before meetings and when things are due.</p>
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                  <button type="button" onClick={() => { void c.enable().catch(() => undefined).finally(() => c.setNotif('on')); }}>Turn on notifications</button>
                  <button type="button" className="tov-link" onClick={() => c.setNotif('later')}>Not now</button>
                </div>
              </>
            )}
          </div>
          <p>Now import your first chat.</p>
        </>
      ),
    },
  ];
}

/** Step 8 — the rep's REAL plan: trial end date, usage, prices from the Subscription screen's config. */
function PlanStep({ ent, usage, now }: { ent: Entitlement | null; usage: AllowanceStatus | null; now: number }): JSX.Element {
  const status = ent?.status ?? 'none';
  const days = ent ? Math.max(0, Math.ceil((ent.trialEndsAt - now) / DAY)) : 0;
  const subscribed = status === 'active';
  return (
    <>
      {status === 'trialing' && ent && (
        <p data-testid="tour-trial">Your free trial ends on {formatBody(ent.trialEndsAt)} ({days} day{days === 1 ? '' : 's'}).</p>
      )}
      {subscribed && ent?.renewsAt != null && <p>You&apos;re subscribed. Your plan renews on {formatBody(ent.renewsAt)}.</p>}
      {!subscribed && (
        <p data-testid="tour-prices">Subscribe here any time: {PLANS.monthly.price} or {PLANS.annual.price}.</p>
      )}
      <div className="tov-tour__usage">
        <div role="meter" aria-label="AI usage this month" aria-valuenow={usage?.percentUsed ?? 0} aria-valuemin={0} aria-valuemax={100} className="tov-tour__usage-bar">
          <div style={{ width: `${usage?.percentUsed ?? 0}%` }} />
        </div>
        <p data-testid="tour-usage">{usage ? usageLabel(usage) : '0%'} used. This shows how much of this month&apos;s AI allowance you&apos;ve used. It resets each billing month.</p>
      </div>
      <p>At 100%, AI features like imports pause until it resets. Find and everything else keep working.</p>
      <p>{subscribed ? 'If you run low, tap Buy more usage here.' : 'Once you subscribe, you can buy extra usage here if you run low.'}</p>
      {/* [P46-6] The Ledger, after Subscription (spotlit: More, where it lives) */}
      <p data-testid="tour-ledger"><strong>The Ledger</strong> shows the deals Tovira helped you win, and what they were worth.</p>
      <p>Notifications and your time zone are in Settings too.</p>
    </>
  );
}
