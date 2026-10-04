import { describe, it, expect, vi } from 'vitest';
import { assertSingleChatRequest, IsolatingModelClient, ChatIsolationError } from '../import/chat-isolation.js';
import { buildPointerUserMessage } from './pointer-prompt.js';
import type { ModelClient, ModelCompletionRequest, ModelCompletionResponse } from '../../ports/model.js';

/**
 * [POINTERS · Task 2] GUARD 4 (pointer call) — the pointer call is ONE chat per call, exactly like
 * extraction. It runs through the same IsolatingModelClient, so a pointer request that carried two chats
 * would be refused before reaching the model. The conversation, the deal state and the client's current
 * pointers all sit INSIDE the single untrusted fence, so a valid pointer request has EXACTLY one fence.
 * MUTATION-PROVEN: in pointer-prompt.ts buildPointerUserMessage, move the deal-state/current-pointers
 * block outside the fence into its own UNTRUSTED_BEGIN/END pair → two fences → this throws → RED.
 */
const pointerMsg = (text: string): ModelCompletionRequest => ({
  system: 'sys',
  messages: [{
    role: 'user',
    content: buildPointerUserMessage({
      today: '2026-10-04', clientName: 'Khalid', source: 'whatsapp_export', text,
      dealState: 'going_cold',
      currentPointers: [{ section: 'relationship', text: 'cares most about service charge', receipts: [{ source_span: 'service charge?', source_message_at: '2026-09-01T09:00' }] }],
    }),
  }],
  maxTokens: 4000, userId: 'u1', spendClass: 'import',
});

describe('[POINTERS] pointer-call isolation (one chat, one call — like extraction)', () => {
  it('a pointer request carrying deal state + current pointers is exactly one fenced chat', () => {
    const req = pointerMsg('is the Marina unit still available?');
    expect(() => assertSingleChatRequest(req)).not.toThrow();
    const content = req.messages[0]!.content as string;
    expect((content.match(/<<<TOVIRA_UNTRUSTED_BEGIN>>>/g) ?? []).length).toBe(1);
    expect(content).toContain('cares most about service charge'); // the current pointers really are in it
    expect(content).toContain('DEAL STATE: going_cold'); // the deal state really is in it
  });

  it('REFUSES a pointer request whose user message concatenates two chats', () => {
    const a = buildPointerUserMessage({ today: '2026-10-04', clientName: 'A', source: 'whatsapp_export', text: 'chat A', dealState: 'open', currentPointers: [] });
    const b = buildPointerUserMessage({ today: '2026-10-04', clientName: 'B', source: 'whatsapp_export', text: 'chat B', dealState: 'open', currentPointers: [] });
    const merged: ModelCompletionRequest = { messages: [{ role: 'user', content: `${a}\n\n${b}` }], userId: 'u1' };
    expect(() => assertSingleChatRequest(merged)).toThrow(ChatIsolationError);
  });

  it('IsolatingModelClient throws BEFORE calling inner when the pointer request carries two chats', async () => {
    const inner: ModelClient = { complete: vi.fn(async (): Promise<ModelCompletionResponse> => ({ text: '{}' })) };
    const client = new IsolatingModelClient(inner);
    const a = buildPointerUserMessage({ today: '2026-10-04', clientName: 'A', source: 'whatsapp_export', text: 'a', dealState: 'open', currentPointers: [] });
    const b = buildPointerUserMessage({ today: '2026-10-04', clientName: 'B', source: 'whatsapp_export', text: 'b', dealState: 'open', currentPointers: [] });
    await expect(client.complete({ messages: [{ role: 'user', content: a + b }], userId: 'u1' })).rejects.toThrow(ChatIsolationError);
    expect(inner.complete).not.toHaveBeenCalled();
  });
});
