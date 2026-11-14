/**
 * [P70 · owner] "Pick your world": six industry tabs and the client-said / Tovira-caught / your-move panels, as drawn
 * in the approved design. Real tab buttons (aria-selected, roving tabindex, arrow keys, Home and End), Property first.
 * The panel fades in on each change.
 */
import { ACCENT, WORLDS } from './landing-data.js';
import { esc } from './game.js';

const ON = 'background:' + ACCENT + ';color:#171412;border:1px solid ' + ACCENT + ';border-radius:999px;padding:12px 20px;font-size:15px;font-weight:600;min-height:44px';
const OFF = 'background:transparent;color:#F2EDE4;border:1px solid #4A423B;border-radius:999px;padding:12px 20px;font-size:15px;font-weight:500;min-height:44px';

export function tabsHtml(picked: number): string {
  return WORLDS.map((w, i) => {
    const on = i === picked;
    return `<button class="tv-tab" type="button" role="tab" id="world-tab-${i}" aria-controls="world-panel" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-w="${i}" style="${on ? ON : OFF}">${esc(w.label)}</button>`;
  }).join('');
}

export function panelHtml(picked: number): string {
  const cur = WORLDS[picked]!;
  return `<div style="flex: 1 1 320px; min-width: 0; background: #1F1B18; border: 1px solid #332D28; border-radius: 22px; padding: 24px; display: flex; flex-direction: column; gap: 14px">`
    + `<div style="font-family: 'JetBrains Mono', 'JetBrains Mono Fallback', monospace; font-size: 12px; letter-spacing: 0.14em; color: #A79E92">WHAT THE CLIENT SAID</div>`
    + `<div data-world="said" style="font-size: 19px; line-height: 1.55">${esc(cur.before)}<span style="background: rgba(232,100,58,0.22); color: #FFD9C9; box-shadow: 0 0 0 1px rgba(232,100,58,0.6); border-radius: 6px; padding: 1px 4px">${esc(cur.buried)}</span>${esc(cur.after)}</div>`
    + `<div style="font-size: 13px; color: #A79E92">${esc(cur.source)}</div>`
    + `</div>`
    + `<div style="flex: 1 1 280px; min-width: 0; background: #F2EDE4; color: #171412; border-radius: 22px; padding: 24px; display: flex; flex-direction: column; gap: 14px">`
    + `<div style="font-family: 'JetBrains Mono', 'JetBrains Mono Fallback', monospace; font-size: 12px; letter-spacing: 0.14em; color: #5E554C">TOVIRA CAUGHT</div>`
    + `<div data-world="caught" style="font-family: Fraunces, 'Fraunces Fallback', Georgia, serif; font-size: 28px; font-weight: 600; line-height: 1.15">${esc(cur.caught)}</div>`
    + `<div style="font-size: 13px; color: #5E554C">Linked to the message it came from. Shown in the brief before your next meeting.</div>`
    + `</div>`
    + `<div style="flex: 1 1 240px; min-width: 0; border: 1px dashed #4A423B; border-radius: 22px; padding: 24px; display: flex; flex-direction: column; gap: 14px">`
    + `<div style="font-family: 'JetBrains Mono', 'JetBrains Mono Fallback', monospace; font-size: 12px; letter-spacing: 0.14em; color: #A79E92">YOUR MOVE</div>`
    + `<div data-world="move" style="font-size: 21px; line-height: 1.4; font-weight: 500">${esc(cur.move)}</div>`
    + `<div style="font-size: 13px; color: #A79E92">You decide. Tovira just makes sure you saw it.</div>`
    + `</div>`;
}

/** Keyboard: Left/Right move and select (wrapping), Home/End jump. */
export function keyTarget(key: string, at: number, n = WORLDS.length): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (at + 1) % n;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (at - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return null;
}

export function mountWorlds(list: HTMLElement, panel: HTMLElement): { picked: () => number } {
  let picked = Math.max(0, [...list.querySelectorAll('[role="tab"]')].findIndex((t) => t.getAttribute('aria-selected') === 'true'));
  const pick = (i: number, focus: boolean): void => {
    if (i !== picked) {
      picked = i;
      list.innerHTML = tabsHtml(picked);
      panel.innerHTML = panelHtml(picked);
      panel.setAttribute('aria-labelledby', `world-tab-${picked}`);
      panel.classList.remove('tv-fade');
      void panel.offsetWidth; // restart the fade
      panel.classList.add('tv-fade');
    }
    if (focus) list.querySelector<HTMLElement>(`#world-tab-${picked}`)?.focus();
  };
  list.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-w]');
    if (t) pick(Number(t.dataset.w), true);
  });
  list.addEventListener('keydown', (e) => {
    const to = keyTarget(e.key, picked);
    if (to === null) return;
    e.preventDefault();
    pick(to, true);
  });
  return { picked: () => picked };
}
