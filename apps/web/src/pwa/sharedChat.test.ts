import { describe, it, expect, vi } from 'vitest';
import { readSharedChat, consumeSharedChat, type SharedChat, type SharedChatStore } from './sharedChat.js';

function form(fields: Record<string, string | File>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}
const txt = (body: string) => new File([body], 'chat.txt', { type: 'text/plain' });

describe('[SITE/FLOWS-1] readSharedChat — the share-target POST body', () => {
  it('reads a shared file as BYTES (base64), never as text — so a .zip survives', async () => {
    const chat = await readSharedChat(form({ file: txt('12/03/2026, 14:02 - Sara: hi'), title: "Sara's chat" }));
    expect(chat).not.toBeNull();
    expect(chat!.text).toBeNull(); // not stringified into text
    expect(chat!.base64).not.toBeNull();
    expect(atob(chat!.base64!)).toContain('Sara: hi'); // the bytes round-trip
    expect(chat!.title).toBe("Sara's chat");
  });

  it('falls back to a shared text field when no file is attached', async () => {
    const chat = await readSharedChat(form({ text: 'pasted export body' }));
    expect(chat!.text).toBe('pasted export body');
    expect(chat!.base64).toBeNull();
    expect(chat!.title).toBeNull();
  });

  // NEGATIVE: nothing usable shared → null (nothing to import), never a crash.
  it('returns null when there is no file and no text', async () => {
    expect(await readSharedChat(form({ title: 'x' }))).toBeNull();
    expect(await readSharedChat(form({ file: txt('') }))).toBeNull(); // an empty (zero-byte) file
  });
});

describe('[FLOWS-1] consumeSharedChat — the SW → app handoff', () => {
  function memStore(initial: SharedChat | null): SharedChatStore & { taken: number } {
    let held = initial;
    const s = {
      taken: 0,
      async put(c: SharedChat) { held = c; },
      async take() { s.taken += 1; const v = held; held = null; return v; },
    };
    return s;
  }

  it('delivers a pending shared chat to the app once, then clears it', async () => {
    const store = memStore({ text: 'exported chat', base64: null, title: null });
    const onChat = vi.fn();
    expect(await consumeSharedChat(store, onChat)).toBe(true);
    expect(onChat).toHaveBeenCalledWith({ text: 'exported chat', base64: null, title: null });
    // consumed — a second run finds nothing (no re-import on refresh)
    expect(await consumeSharedChat(store, onChat)).toBe(false);
    expect(onChat).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is no pending shared chat', async () => {
    const onChat = vi.fn();
    expect(await consumeSharedChat(memStore(null), onChat)).toBe(false);
    expect(onChat).not.toHaveBeenCalled();
  });

  it('never throws if the store fails (share is best-effort, app still loads)', async () => {
    const bad: SharedChatStore = { put: vi.fn(), take: vi.fn().mockRejectedValue(new Error('idb blocked')) };
    await expect(consumeSharedChat(bad, vi.fn())).resolves.toBe(false);
  });
});
