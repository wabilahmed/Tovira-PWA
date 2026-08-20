/**
 * Reveal-on-scroll for the marketing pages (brand v1.2 §0a marketing-motion
 * exception): opacity 0→1 + a 12px rise, 200ms ease-out, staggered 60ms for
 * grouped items, firing ONCE via IntersectionObserver. Also drives the §4 sticky
 * phone whose screen swaps per step, and the mobile sticky CTA that appears after
 * the hero.
 *
 * Progressive enhancement — content is visible without JS (the hidden state is
 * gated on `.js`, added synchronously in the page head); this only ADDS the
 * animation. Fully collapsed under prefers-reduced-motion (see site.css). No
 * animation library. Nothing can stay permanently hidden: if IntersectionObserver
 * is absent, or never fires, everything is revealed (absence check + fallback
 * timer). Imports no app code.
 */

/** Reveal every [data-reveal] block as it scrolls in (once). */
function initReveal(doc: Document): void {
  const targets = [...doc.querySelectorAll<HTMLElement>('[data-reveal]')];
  if (targets.length === 0) return;
  const revealAll = (): void => targets.forEach((el) => el.setAttribute('data-revealed', ''));

  if (typeof IntersectionObserver === 'undefined') {
    revealAll(); // no observer → show everything, no animation
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.setAttribute('data-revealed', '');
          io.unobserve(e.target); // fire once
        }
      }
    },
    // Trigger as the element enters the lower viewport so the long entrance plays
    // WHILE it scrolls up into place (the "coming into view" feel).
    { threshold: 0, rootMargin: '0px 0px -14% 0px' },
  );
  targets.forEach((el) => io.observe(el));
  // Safety net: nothing may remain hidden if the observer never fires.
  setTimeout(() => targets.forEach((el) => el.hasAttribute('data-revealed') || el.setAttribute('data-revealed', '')), 1600);
}

/** §4: swap the pinned phone's screen as each step enters view. */
function initStepFrame(doc: Document): void {
  const steps = [...doc.querySelectorAll<HTMLElement>('.step[data-step]')];
  const screens = [...doc.querySelectorAll<HTMLElement>('.how__screen[data-step-screen]')];
  if (steps.length === 0 || screens.length === 0 || typeof IntersectionObserver === 'undefined') return;
  const show = (i: string): void => screens.forEach((s) => (s.dataset.stepScreen === i ? s.setAttribute('data-active', '') : s.removeAttribute('data-active')));
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) show((e.target as HTMLElement).dataset.step ?? '0');
    },
    { threshold: 0.5 },
  );
  steps.forEach((s) => io.observe(s));
}

/** The mobile sticky CTA slides in once the hero has scrolled away. */
function initMobileCta(doc: Document): void {
  const bar = doc.querySelector<HTMLElement>('[data-mobile-cta]');
  const hero = doc.querySelector<HTMLElement>('.hero');
  if (!bar) return;
  bar.hidden = false;
  if (!hero || typeof IntersectionObserver === 'undefined') return;
  const io = new IntersectionObserver(([e]) => bar.classList.toggle('is-visible', !e!.isIntersecting), { threshold: 0 });
  io.observe(hero);
}

export function initMarketingMotion(doc: Document = document): void {
  initReveal(doc);
  initStepFrame(doc);
  initMobileCta(doc);
}
