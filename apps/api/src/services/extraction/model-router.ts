/**
 * Per-account extraction model routing (P5-7). Trial accounts get Sonnet-grade
 * extraction regardless of unit cost (best first impression); paid accounts use
 * the P1-9-selected production model. The route is resolved ONCE per note so a
 * retry never switches models mid-sequence (cache + training-log consistency).
 */
import type { ModelClient } from '../../ports/model.js';

export interface ModelRoute {
  model: ModelClient;
  modelId: string;
}

export interface ModelRouter {
  resolve(userId: string): Promise<ModelRoute>;
}

export class BillingModelRouter implements ModelRouter {
  constructor(
    /** Returns the billing status ('trialing' | 'active' | 'none' | …). */
    private readonly statusOf: (userId: string, nowMs: number) => Promise<string>,
    private readonly production: ModelRoute,
    private readonly trial: ModelRoute,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async resolve(userId: string): Promise<ModelRoute> {
    const status = await this.statusOf(userId, this.now());
    return status === 'trialing' ? this.trial : this.production;
  }
}
