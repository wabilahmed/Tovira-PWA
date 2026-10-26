import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RecordingTranscriber, setTranscriptionEventSink } from './recording-transcriber.js';
import type { Transcriber, TranscriptionResult } from '../../ports/transcriber.js';
import type { TranscriptionEvent } from '../../ports/cost-report.js';

/**
 * [P44-2] Every completed voice-note transcription is recorded (user, audio seconds, model, billing period), so the
 * ops cost report can work out the Groq cost per user. Seconds are the provider's; without them, the byte-based
 * estimate (marked estimated). Recording never breaks a transcription, and a failed transcription records nothing.
 */
const inner = (r: TranscriptionResult | Error): Transcriber => ({ transcribe: async () => { if (r instanceof Error) throw r; return r; } });
afterEach(() => setTranscriptionEventSink(undefined));

describe('[P44-2] RecordingTranscriber', () => {
  it('records the provider\'s seconds, the model and the rep\'s period', async () => {
    const seen: TranscriptionEvent[] = [];
    setTranscriptionEventSink({ periodKeyFor: async () => 'p:1700000000000', record: async (e) => { seen.push(e); } });
    const t = new RecordingTranscriber(inner({ text: 'hi', quality: 'ok', durationSeconds: 31.5 }), 'whisper-large-v3', () => 1_800_000_000_000);
    await t.transcribe('u1', new Uint8Array(10));
    expect(seen).toEqual([{ userId: 'u1', periodKey: 'p:1700000000000', model: 'whisper-large-v3', audioSeconds: 31.5, estimated: false, at: 1_800_000_000_000 }]);
  });

  it('without a provider duration: the byte-based estimate, marked estimated', async () => {
    const seen: TranscriptionEvent[] = [];
    setTranscriptionEventSink({ periodKeyFor: async () => null, record: async (e) => { seen.push(e); } });
    await new RecordingTranscriber(inner({ text: 'hi', quality: 'ok' }), 'whisper-large-v3').transcribe('u1', new Uint8Array(120_000));
    expect(seen[0]).toMatchObject({ audioSeconds: 10, estimated: true }); // 120000 bytes at 12000 B/s
  });

  it('NEGATIVE: a failed transcription records nothing; a failing recorder never breaks the transcription', async () => {
    const seen: TranscriptionEvent[] = [];
    setTranscriptionEventSink({ periodKeyFor: async () => null, record: async (e) => { seen.push(e); } });
    await expect(new RecordingTranscriber(inner(new Error('groq down')), 'm').transcribe('u1', new Uint8Array(1))).rejects.toThrow('groq down');
    expect(seen).toEqual([]);
    setTranscriptionEventSink({ periodKeyFor: async () => null, record: async () => { throw new Error('db down'); } });
    await expect(new RecordingTranscriber(inner({ text: 'ok', quality: 'ok', durationSeconds: 5 }), 'm').transcribe('u1', new Uint8Array(1))).resolves.toMatchObject({ text: 'ok' });
  });

  it('migration 0097 adds transcription_events and revenue_events (ops-only, append-only, idempotent revenue)', () => {
    const sql = readFileSync(fileURLToPath(new URL('../../../migrations/0097_cost_report_sources.sql', import.meta.url)), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS transcription_events/);
    expect(sql).toMatch(/audio_seconds\s+double precision NOT NULL CHECK \(audio_seconds >= 0\)/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS revenue_events/);
    expect(sql).toMatch(/stripe_id\s+text PRIMARY KEY/);
    expect(sql).toMatch(/kind\s+text NOT NULL CHECK \(kind IN \('subscription', 'topup'\)\)/);
    expect(sql).toMatch(/GRANT SELECT, INSERT ON transcription_events TO tovira_app/);
    expect(sql).toMatch(/GRANT SELECT, INSERT ON revenue_events TO tovira_app/);
    expect(sql).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)[^;]*(transcription_events|revenue_events)/);
  });
});
