/**
 * [BULK-IMPORT · Task 4] D1 — one chat, one call, ALWAYS. The cert standard for bulk import is zero
 * merged people, and the only way two exports' people get merged is if two chats ever share a prompt.
 * This is a STRUCTURAL guard on the outgoing request body: an extraction prompt fences its (single)
 * untrusted chat with the shared UNTRUSTED markers, which appear exactly once per chat. A request whose
 * user content carries more than one fenced chat — however it was assembled — is refused before it can
 * reach a provider. The guard is cheap and provable: feed it two chats and it throws.
 */
import type { ModelClient, ModelCompletionRequest, ModelCompletionResponse } from '../../ports/model.js';
import { UNTRUSTED_BEGIN, UNTRUSTED_END } from '../extraction/untrusted.js';

export class ChatIsolationError extends Error {
  override name = 'ChatIsolationError';
}

function count(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

/**
 * Refuse any extraction request that does not carry EXACTLY one fenced chat (D1). Counts the fence
 * markers across ALL user messages, so neither two chats in one message nor one chat per message
 * can slip through. Requests with no fence at all (a non-extraction call) are left alone.
 */
export function assertSingleChatRequest(req: ModelCompletionRequest): void {
  const userContent = req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  const begins = count(userContent, UNTRUSTED_BEGIN);
  const ends = count(userContent, UNTRUSTED_END);
  if (begins === 0 && ends === 0) return; // not a fenced extraction prompt — not our concern
  if (begins !== 1 || ends !== 1) {
    throw new ChatIsolationError(
      `extraction request must carry exactly one chat (D1); found ${begins} begin / ${ends} end fence(s)`,
    );
  }
}

/** Wraps a ModelClient so every extraction request is checked for single-chat isolation before it is
 *  sent. Used to wrap the extraction model client in production (and bulk import especially). */
export class IsolatingModelClient implements ModelClient {
  constructor(private readonly inner: ModelClient) {}

  async complete(req: ModelCompletionRequest): Promise<ModelCompletionResponse> {
    assertSingleChatRequest(req); // throws → a rejected promise, before inner is ever touched
    return this.inner.complete(req);
  }
}
