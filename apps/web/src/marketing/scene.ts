/**
 * [P89 · owner, Prompt 86] The landing's scroll scene, ported from the script in plan/tovira-landing-marker.html. One
 * pinned full-screen stage inside a tall wrapper (index.html .scene / .stage); scroll progress p (0 to 1) plays five
 * beats: the headline, the message coming forward, the yellow marker stroke sweeping across it, the black "Tovira
 * caught" card, then the brief with Start free. The chat columns behind drift on their own and faster with scroll; they
 * are decorative (aria-hidden). Only transform and opacity are animated. The frame loop runs only while the scene is on
 * screen and the tab is visible. With reduced motion the CSS stacks the five beats as a plain page and nothing here runs
 * except the beat counts (by what is on screen).
 *
 * The timings are the reference's, tuned after the Playwright screenshots (e2e/landing-usecases.spec.ts).
 * [P89 · owner, 28 Nov, scene scrolling fix] The visitor is never left on a blank or half-faded screen: five stops at
 * progress 0, 0.25, 0.5, 0.75 and 1 (BEATS), each beat whole at its stop; the beats cross-fade (the next starts coming
 * in before the last has gone, so every scroll position shows a readable beat); and when scrolling stops between two
 * stops for about 110ms the page glides on to the next stop in the direction the visitor was going (settleTarget).
 * Any touch, wheel or key cancels the glide; their scroll input is never intercepted or prevented. Past the last stop
 * the page scrolls on normally; coming back up into the scene from below settles on the last stop. No settle with
 * reduced motion (the scene does not run at all).
 */
export const LINES = ["Ok thanks", "Can we do Sunday?", "Send me the brochure please", "Kids have football on Saturday", "Will check with my wife", "What's the service charge?", "Running late, 10 mins", "Looks good", "Is parking included?", "Let me think about it", "We'd need it before September", "Call you tomorrow", "Thanks for today", "Any update on the offer?", "Sounds fair", "Morning! Are you free at 3?", "I'll confirm by Friday"];

/** The five stops: the scroll progress at which each beat (1 to 5) is fully on screen. */
export const BEATS = [0, 0.25, 0.5, 0.75, 1] as const;
/** The progress from which each beat is whole on screen (for the counts and keyboard focus): b2 is in by 0.16, the
 *  stroke and its caption complete by 0.48, the black card in by 0.66, the brief by 0.91. */
export const REACH = [0, 0.16, 0.48, 0.66, 0.91] as const;
/** How long scrolling must pause before the settle (ms), and how near a stop counts as on it (progress). */
export const SETTLE_MS = 110;
export const ON_STOP = 0.003;

export const cl = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const seg = (p: number, a: number, b: number): number => cl((p - a) / (b - a));
export const ease = (x: number): number => x * x * (3 - 2 * x);

/** The beat reached at progress p (1 to 5). */
export const beatAt = (p: number): number => { let b = 1; REACH.forEach((at, i) => { if (p >= at) b = i + 1; }); return b; };

/**
 * Where the settle goes when scrolling pauses at progress p, or null to stay. `dir` is the way the visitor was moving
 * (1 down, -1 up); `fromBelow` is true when this scroll began past the end of the scene. Outside the scene (p at 0 or
 * 1, which progress() clamps to) and on a stop: stay.
 */
export function settleTarget(p: number, dir: number, fromBelow = false): number | null {
  if (p <= 0 || p >= 1 || !dir) return null;
  if (BEATS.some((b) => Math.abs(p - b) < ON_STOP)) return null;
  if (fromBelow && dir < 0 && p > BEATS[3]) return 1;
  if (dir > 0) return BEATS.find((b) => b > p) ?? null;
  return [...BEATS].reverse().find((b) => b < p) ?? null;
}

export interface BeatFrame { b1: number; b2: number; b4: number; b5: number; stroke: number; cap3: number; big: number; cols: number; b1Lift: number; b2Lift: number; b4Lift: number; b5Lift: number }

/** Every beat's opacity (and the stroke's sweep) at progress p: pure, so the timings are unit-tested. */
export function frameAt(p: number): BeatFrame {
  const inOut = (inn: [number, number], out: [number, number] | null, lift = 40): [number, number] => {
    const a = ease(seg(p, inn[0], inn[1])); const o = out ? ease(seg(p, out[0], out[1])) : 0;
    return [a * (1 - o), (1 - a) * lift - o * 40];
  };
  // each change is a cross-fade: the next beat starts in 0.04 before the last starts out, over 0.12 each
  const b1o = ease(seg(p, 0.08, 0.2));
  const [b2, b2Lift] = inOut([0.04, 0.16], [0.56, 0.68]);
  const [b4, b4Lift] = inOut([0.54, 0.66], [0.81, 0.93]);
  const [b5, b5Lift] = inOut([0.79, 0.91], null);
  return {
    b1: 1 - b1o, b1Lift: -b1o * 60, b2, b2Lift, b4, b4Lift, b5, b5Lift,
    stroke: ease(seg(p, 0.3, 0.45)), cap3: ease(seg(p, 0.4, 0.48)),
    big: 0.92 + 0.08 * ease(seg(p, 0.04, 0.2)), cols: 1 - ease(seg(p, 0.5, 0.66)) * 0.85,
  };
}

function fill(el: HTMLElement, off: number): void {
  for (let i = 0; i < 84; i++) {
    const d = document.createElement('div');
    d.className = 'msg' + (i % 4 === 0 ? ' me' : '');
    d.textContent = LINES[(i * 5 + off) % LINES.length]!;
    el.appendChild(d);
  }
}

export type BeatSink = (beat: number) => void;

/** Mount the scene. `onBeat` is called once per beat (1 to 5) the first time it is reached in this page view. */
export function mountScene(doc: Document = document, win: Window = window, onBeat?: BeatSink): void {
  const $ = (id: string): HTMLElement | null => doc.getElementById(id);
  const scene = $('scene'); const c1 = $('c1'); const c2 = $('c2'); const c3 = $('c3');
  if (!scene || !c1 || !c2 || !c3) return;
  fill(c1, 0); fill(c2, 7); fill(c3, 3);
  const seen = new Set<number>();
  const reach = (b: number): void => { for (let i = 1; i <= b; i++) if (!seen.has(i)) { seen.add(i); try { onBeat?.(i); } catch { /* never in the way */ } } };
  const reduce = !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const beats = ['b1', 'b2', 'b2', 'b4', 'b5'].map($);

  if (reduce) {
    // the stacked page: a beat is reached when it is on screen (the stroke with the message, beat 3)
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { const i = beats.indexOf(e.target as HTMLElement); reach(i === 1 ? 3 : i + 1); }
    }, { threshold: 0.5 });
    for (const b of new Set(beats)) if (b) io.observe(b);
    return;
  }

  if (!doc.documentElement.classList.contains('scene-on')) return; // stacked page (or the 4s fallback already fired)
  (win as unknown as { __tovScene?: boolean }).__tovScene = true;
  const b1 = beats[0]!; const b2 = beats[1]!; const b4 = beats[3]!; const b5 = beats[4]!;
  const stroke = $('stroke')!; const cap3 = $('cap3')!; const big = $('big')!; const cols = c1.parentElement!;
  let periods = [0, 0, 0]; let top = 0; let max = 0;
  const measure = (): void => {
    periods = [c1, c2, c3].map((el) => (el.children[36] as HTMLElement).offsetTop - (el.children[0] as HTMLElement).offsetTop || 1);
    top = scene.getBoundingClientRect().top + win.scrollY;
    max = scene.offsetHeight - win.innerHeight;
  };
  measure();
  win.addEventListener('resize', measure);
  const progress = (): number => (max > 0 ? cl((win.scrollY - top) / max) : 0);
  const place = (el: HTMLElement, o: number, lift: number): void => {
    el.style.opacity = String(o);
    el.style.transform = `translate(-50%,calc(-50% + ${lift}px))`;
    el.style.pointerEvents = o > 0.5 ? 'auto' : 'none';
  };
  const t0 = win.performance.now();
  const draw = (now: number): void => {
    const p = progress();
    const idle = ((now - t0) / 1000) * 12; const s = p * 2600;
    c1.style.transform = `translateY(${-((idle * 0.6 + s * 0.55) % periods[0]!)}px)`;
    c2.style.transform = `translateY(${-((idle + s) % periods[1]!)}px)`;
    c3.style.transform = `translateY(${-((idle * 0.8 + s * 0.75) % periods[2]!)}px)`;
    const f = frameAt(p);
    cols.style.opacity = String(f.cols);
    place(b1, f.b1, f.b1Lift); b1.style.pointerEvents = p < 0.1 ? 'auto' : 'none';
    place(b2, f.b2, f.b2Lift);
    stroke.style.transform = `scaleX(${f.stroke}) rotate(-1deg)`;
    cap3.style.opacity = String(f.cap3);
    big.style.transform = `scale(${f.big})`;
    place(b4, f.b4, f.b4Lift);
    place(b5, f.b5, f.b5Lift);
    reach(beatAt(p));
  };

  // the loop runs only while the scene is on screen and the tab is visible
  let onScreen = true; let raf = 0;
  const loop = (now: number): void => { draw(now); raf = onScreen && !doc.hidden ? win.requestAnimationFrame(loop) : 0; };
  const wake = (): void => { if (!raf && onScreen && !doc.hidden) raf = win.requestAnimationFrame(loop); };
  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver((es) => { onScreen = es.some((e) => e.isIntersecting); if (onScreen) { measure(); wake(); } }).observe(scene);
  }
  doc.addEventListener('visibilitychange', wake);
  wake();

  // the settle: scrolling paused between two stops glides on to the next one the visitor was heading for
  let lastY = win.scrollY; let dir = 0; let startY: number | null = null; let timer = 0; let touching = false; let moved = false;
  let gliding: number | null = null; let glideEnd = 0;
  const stopGlide = (): void => {
    win.clearTimeout(timer); timer = 0;
    if (gliding !== null) { gliding = null; win.clearTimeout(glideEnd); win.scrollTo({ top: win.scrollY, behavior: 'instant' as ScrollBehavior }); }
  };
  const settle = (): void => {
    timer = 0;
    const fromBelow = startY !== null && startY > top + max + 2;
    startY = null;
    if (touching) return;
    const to = settleTarget(progress(), dir, fromBelow);
    if (to === null) return;
    gliding = top + to * max;
    win.scrollTo({ top: gliding, behavior: 'smooth' });
    glideEnd = win.setTimeout(() => { gliding = null; }, 1500);
  };
  const arm = (): void => { win.clearTimeout(timer); timer = win.setTimeout(settle, SETTLE_MS); };
  win.addEventListener('scroll', () => {
    const y = win.scrollY; const was = lastY;
    if (y !== was) dir = y > was ? 1 : -1;
    lastY = y;
    if (gliding !== null) { if (Math.abs(y - gliding) < 2) { gliding = null; win.clearTimeout(glideEnd); } return; }
    if (startY === null) startY = was; // where this scroll began
    moved = true;
    if (!touching) arm();
  }, { passive: true });
  win.addEventListener('wheel', stopGlide, { passive: true });
  win.addEventListener('keydown', stopGlide, { passive: true });
  win.addEventListener('touchstart', () => { touching = true; moved = false; stopGlide(); }, { passive: true });
  const lift = (): void => { touching = false; if (moved) arm(); };
  win.addEventListener('touchend', lift, { passive: true });
  win.addEventListener('touchcancel', lift, { passive: true });

  // keyboard: a beat's link that takes focus scrolls the page to where that beat is fully shown
  beats.forEach((b, i) => b?.addEventListener('focusin', () => {
    if (beatAt(progress()) === i + 1) return;
    win.scrollTo({ top: top + BEATS[i]! * max, behavior: 'instant' as ScrollBehavior });
    draw(win.performance.now());
  }));
}
