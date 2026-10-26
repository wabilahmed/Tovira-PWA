import { describe, it, expect } from 'vitest';
import { PushDispatchService } from './push-dispatch-service.js';
import { InMemoryPushSubscriptionRepository } from '../../adapters/push/in-memory-push-subscription-repository.js';
import { InMemoryNotificationRepository } from '../../adapters/notifications/in-memory-notification-repository.js';
import { StubPushSender } from '../../adapters/push/stub-sender.js';

// [P46-2] A meeting nudge reaches every live device even when one stored subscription is dead, and a gone (404 / 410)
// subscription is removed so it is never tried again. Before: the first throw ended the loop for every device after it.
describe('[P46-2] dispatch survives a dead device', () => {
  it('pushes to the live device, deletes the gone one, and NEGATIVE: never throws', async () => {
    const subs = new InMemoryPushSubscriptionRepository();
    const sender = new StubPushSender();
    const svc = new PushDispatchService(sender, subs, new InMemoryNotificationRepository());
    await subs.save('u1', { endpoint: 'https://push.example/dead', keys: { p256dh: 'k', auth: 'a' } });
    await subs.save('u1', { endpoint: 'https://push.example/live', keys: { p256dh: 'k', auth: 'a' } });
    sender.goneEndpoints.add('https://push.example/dead');
    const out = await svc.dispatch('u1', [{ type: 'pre_meeting_nudge', dedupeKey: 'm1', clientId: null, title: 'Meeting', body: 'soon' }]);
    expect(out.sent).toHaveLength(1);
    expect(sender.sent.map((s) => s.subscription.endpoint)).toEqual(['https://push.example/live']);
    expect((await subs.listByUser('u1')).map((s) => s.endpoint)).toEqual(['https://push.example/live']);
  });
});
