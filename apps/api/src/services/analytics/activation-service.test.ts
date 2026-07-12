import { describe, it, expect } from 'vitest';
import { ActivationService } from './activation-service.js';
import { InMemoryAnalytics, InMemoryActivationRepository } from '../../adapters/analytics/in-memory.js';

function make() {
  const analytics = new InMemoryAnalytics();
  const activations = new InMemoryActivationRepository();
  return { analytics, service: new ActivationService(activations, analytics) };
}

describe('[P7-3] activation instrumentation', () => {
  it('fires the activation event exactly once, not on repeat brief views', async () => {
    const { analytics, service } = make();
    await service.onBriefViewed('u', 1000);
    await service.onBriefViewed('u', 2000); // repeat view
    expect(analytics.events.filter((e) => e.event === 'activation.first_brief')).toHaveLength(1);
  });

  it('sends no raw client PII — only user id, event, timestamp', async () => {
    const { analytics, service } = make();
    await service.onBriefViewed('u', 1000);
    const event = analytics.events[0]!;
    expect(Object.keys(event).sort()).toEqual(['at', 'event', 'userId']);
  });

  it('tracks activation per rep independently', async () => {
    const { analytics, service } = make();
    await service.onBriefViewed('a', 1);
    await service.onBriefViewed('b', 1);
    expect(analytics.events.map((e) => e.userId).sort()).toEqual(['a', 'b']);
  });
});
