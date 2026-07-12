import type { Pool } from 'pg';
import type { ApiDeps } from '../server.js';
import { AuthService } from '../services/auth/auth-service.js';
import { ScryptHasher } from '../services/auth/password.js';
import { InMemoryUserRepository } from '../adapters/auth/in-memory-user-repository.js';
import { InMemorySessionRepository } from '../adapters/auth/in-memory-session-repository.js';
import { InMemoryClientRepository } from '../adapters/clients/in-memory-client-repository.js';
import { InMemoryNoteRepository } from '../adapters/notes/in-memory-note-repository.js';
import { InMemoryStorage } from '../adapters/storage/in-memory.js';
import { StubTranscriber } from '../adapters/transcription/stub.js';
import { TranscriptionService } from '../services/transcription/transcription-service.js';
import { StubModelClient } from '../adapters/model/stub.js';
import { InMemoryFactsRepository } from '../adapters/facts/in-memory-facts-repository.js';
import { InMemoryExtractionLogRepository } from '../adapters/logs/in-memory-extraction-log-repository.js';
import { StubEmbedder } from '../adapters/embedding/stub.js';
import { ExtractionService } from '../services/extraction/extraction-service.js';
import { BriefService } from '../services/brief/brief-service.js';
import { FollowUpService } from '../services/followup/follow-up-service.js';
import { InMemoryCorrectionRepository } from '../adapters/corrections/in-memory-correction-repository.js';
import { InMemoryMeetingRepository } from '../adapters/meetings/in-memory-meeting-repository.js';
import { MeetingParser } from '../services/meetings/meeting-parser.js';
import { InMemoryNotificationRepository } from '../adapters/notifications/in-memory-notification-repository.js';
import { ScanService } from '../services/scan/scan-service.js';
import { InMemoryPushSubscriptionRepository } from '../adapters/push/in-memory-push-subscription-repository.js';
import { StubPushSender } from '../adapters/push/stub-sender.js';
import { StubCardScanner } from '../adapters/vision/stub-card-scanner.js';
import { InMemoryImageRepository } from '../adapters/images/in-memory-image-repository.js';

export interface TestDeps extends ApiDeps {
  storage: InMemoryStorage;
  notes: InMemoryNoteRepository;
  clients: InMemoryClientRepository;
}

/**
 * Build a full in-memory ApiDeps for HTTP tests. Central so adding a dependency
 * touches one place, not every test file.
 */
export function buildInMemoryDeps(overrides: Partial<ApiDeps> = {}): TestDeps {
  const stubPool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const auth = new AuthService({
    users: new InMemoryUserRepository(),
    sessions: new InMemorySessionRepository(),
    hasher: new ScryptHasher(),
    sessionTtlMs: 60 * 60 * 1000,
  });
  const notes = new InMemoryNoteRepository();
  const storage = new InMemoryStorage();
  const clients = new InMemoryClientRepository();
  const facts = new InMemoryFactsRepository();
  const transcription = new TranscriptionService(new StubTranscriber('clear transcript'), notes, storage);
  const embedder = new StubEmbedder(8);
  const extraction = new ExtractionService(
    new StubModelClient(),
    clients,
    notes,
    facts,
    embedder,
    new InMemoryExtractionLogRepository(),
    'stub',
  );
  const brief = new BriefService(clients, notes, facts, embedder);
  const followUp = new FollowUpService(new StubModelClient(), notes);
  const corrections = new InMemoryCorrectionRepository();
  const meetings = new InMemoryMeetingRepository();
  const meetingParser = new MeetingParser(new StubModelClient(), clients);
  const notifications = new InMemoryNotificationRepository();
  const scan = new ScanService(clients, meetings, facts, notifications);
  return {
    pool: stubPool,
    auth,
    clients,
    notes,
    storage,
    transcription,
    extraction,
    followUp,
    facts,
    corrections,
    brief,
    meetings,
    meetingParser,
    notifications,
    scan,
    scanConfig: { coldThresholdDays: 30, nudgeLeadMs: 24 * 60 * 60 * 1000, reminderWindowDays: 7 },
    pushSubscriptions: new InMemoryPushSubscriptionRepository(),
    pushSender: new StubPushSender(),
    cardScanner: new StubCardScanner(),
    images: new InMemoryImageRepository(),
    ...overrides,
  } as TestDeps;
}
