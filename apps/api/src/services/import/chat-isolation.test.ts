import { describe, it, expect, vi } from 'vitest';
import { assertSingleChatRequest, IsolatingModelClient, ChatIsolationError } from './chat-isolation.js';
import { buildUserMessage } from '../extraction/prompt.js';
import type { ModelClient, ModelCompletionRequest, ModelCompletionResponse } from '../../ports/model.js';

// [BULK-IMPORT · Task 4] D1: one chat, one call — NEVER two exports in a single prompt (zero merged
// people is the cert standard). The guard inspects the OUTGOING request body and refuses any request
// whose user content carries more than one fenced chat. Anchored on the real prompt fences.
const chatMsg = (text: string): ModelCompletionRequest => ({
  system: 'sys',
  messages: [{ role: 'user', content: buildUserMessage({ today: '2026-10-04', clientName: 'Khalid', source: 'whatsapp_export', text }) }],
  maxTokens: 100,
  userId: 'u1',
  spendClass: 'import',
});

describe('[BULK-IMPORT] chat isolation (D1: one chat, one call)', () => {
  it('passes a request that carries exactly one fenced chat', () => {
    expect(() => assertSingleChatRequest(chatMsg('hey — can you send the Marina quote?'))).not.toThrow();
  });

  it('REFUSES a request whose single user message concatenates two chats', () => {
    const a = buildUserMessage({ today: '2026-10-04', clientName: 'Khalid', source: 'whatsapp_export', text: 'chat A' });
    const b = buildUserMessage({ today: '2026-10-04', clientName: 'Omar', source: 'whatsapp_export', text: 'chat B' });
    const merged: ModelCompletionRequest = { messages: [{ role: 'user', content: `${a}\n\n${b}` }], userId: 'u1' };
    expect(() => assertSingleChatRequest(merged)).toThrow(ChatIsolationError);
  });

  it('REFUSES a request that splits two chats across two user messages', () => {
    const two: ModelCompletionRequest = {
      messages: [
        { role: 'user', content: buildUserMessage({ today: '2026-10-04', clientName: 'Khalid', source: 'whatsapp_export', text: 'chat A' }) },
        { role: 'user', content: buildUserMessage({ today: '2026-10-04', clientName: 'Omar', source: 'whatsapp_export', text: 'chat B' }) },
      ],
      userId: 'u1',
    };
    expect(() => assertSingleChatRequest(two)).toThrow(ChatIsolationError);
  });

  it('IsolatingModelClient forwards a valid single-chat request to the inner client', async () => {
    const inner: ModelClient = { complete: vi.fn(async (): Promise<ModelCompletionResponse> => ({ text: '{}' })) };
    const client = new IsolatingModelClient(inner);
    const res = await client.complete(chatMsg('just one chat'));
    expect(res.text).toBe('{}');
    expect(inner.complete).toHaveBeenCalledOnce();
  });

  it('IsolatingModelClient throws BEFORE calling inner when two chats are present', async () => {
    const inner: ModelClient = { complete: vi.fn(async (): Promise<ModelCompletionResponse> => ({ text: '{}' })) };
    const client = new IsolatingModelClient(inner);
    const a = buildUserMessage({ today: '2026-10-04', clientName: 'A', source: 'whatsapp_export', text: 'a' });
    const b = buildUserMessage({ today: '2026-10-04', clientName: 'B', source: 'whatsapp_export', text: 'b' });
    await expect(client.complete({ messages: [{ role: 'user', content: a + b }], userId: 'u1' })).rejects.toThrow(ChatIsolationError);
    expect(inner.complete).not.toHaveBeenCalled();
  });
});
