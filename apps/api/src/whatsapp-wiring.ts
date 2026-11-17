/**
 * [P72-1 · owner] What the API builds at boot for WhatsApp (composition root, beside container.ts: it picks the concrete
 * Graph adapter, which the services/ layer may not import). Without the three keys nothing is built and every WhatsApp
 * path stays a 404 (P67's "switched off"). With them, the webhook exists so Meta's verify check can be answered; whether
 * anything is processed, and who sees it in Settings, is decided per request by `enabled` and `allowed`.
 */
import { CloudApiGraph } from './adapters/whatsapp/graph-client.js';
import type { Storage } from './ports/storage.js';
import type { WhatsAppGraph, WhatsAppLinkStore } from './ports/whatsapp.js';
import { FixedWindowRateLimiter } from './services/security/rate-limiter.js';
import { WhatsAppService } from './services/whatsapp/whatsapp-service.js';
import { activeNumber, whatsappAllowed, whatsappKeysReady, type WhatsAppConfig } from './services/whatsapp/whatsapp-config.js';

export interface WhatsAppParts {
  store: WhatsAppLinkStore;
  storage: Storage;
  appBaseUrl: string;
  entitlement: (userId: string, nowMs: number) => Promise<{ entitled: boolean; status: string }>;
  longChatLimit: number | null;
  fetchImpl?: typeof fetch;
}

export interface BuiltWhatsApp {
  service: WhatsAppService;
  graph: WhatsAppGraph;
  appSecret: string;
  verifyToken: string;
  enabled: boolean;
  allowed: (email: string | null) => boolean;
}

const HOUR = 60 * 60 * 1000;

export function buildWhatsApp(cfg: WhatsAppConfig, parts: WhatsAppParts): BuiltWhatsApp | undefined {
  if (!whatsappKeysReady(cfg)) return undefined;
  const number = activeNumber(cfg);
  const graph = new CloudApiGraph({ accessToken: cfg.accessToken, phoneNumberId: number.phoneNumberId, ...(parts.fetchImpl ? { fetchImpl: parts.fetchImpl } : {}) });
  const service = new WhatsAppService({
    settings: { businessNumber: number.displayNumber, appBaseUrl: parts.appBaseUrl },
    store: parts.store, graph, storage: parts.storage, entitlement: parts.entitlement, longChatLimit: parts.longChatLimit,
    // [P67 · owner] replies cost money past 1,000 a month: one "not linked" per number a day, 3 help replies an hour,
    // 30 chats per rep an hour.
    unlinkedReplies: new FixedWindowRateLimiter(1, 24 * HOUR),
    helpReplies: new FixedWindowRateLimiter(3, HOUR),
    perRep: new FixedWindowRateLimiter(30, HOUR),
  });
  return { service, graph, appSecret: cfg.appSecret, verifyToken: cfg.verifyToken, enabled: cfg.enabled, allowed: (email) => whatsappAllowed(cfg, email) };
}
