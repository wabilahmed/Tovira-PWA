import { describe, it, expect } from 'vitest';
import { fixtures } from './fixtures.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// [P0-6] Fixtures must be realistic and varied so we can build/test against
// representative data — and deterministic so re-seeding is idempotent.
describe('seed fixtures', () => {
  it('provides several clients', () => {
    expect(fixtures.clients.length).toBeGreaterThanOrEqual(3);
  });

  it('gives every client at least one note', () => {
    for (const client of fixtures.clients) {
      const notes = fixtures.notes.filter((n) => n.clientId === client.id);
      expect(notes.length, `client ${client.name}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('varies the note source (voice AND paste)', () => {
    const sources = new Set(fixtures.notes.map((n) => n.source));
    expect(sources.has('voice')).toBe(true);
    expect(sources.has('paste')).toBe(true);
  });

  it('has substantial, realistic raw text on every note', () => {
    for (const note of fixtures.notes) {
      expect(note.rawText.trim().length).toBeGreaterThan(30);
    }
  });

  it('carries extracted facts in the v0.1 shape on every note', () => {
    for (const note of fixtures.notes) {
      expect(note.extracted).toHaveProperty('promises');
      expect(note.extracted).toHaveProperty('people');
      expect(note.extracted).toHaveProperty('personal_facts');
      expect(note.extracted).toHaveProperty('summary');
    }
  });

  it('references only real client ids from notes', () => {
    const clientIds = new Set(fixtures.clients.map((c) => c.id));
    for (const note of fixtures.notes) {
      expect(clientIds.has(note.clientId)).toBe(true);
    }
  });

  it('uses deterministic, unique uuids (so re-seeding is idempotent)', () => {
    expect(fixtures.clients.every((c) => UUID.test(c.id))).toBe(true);
    expect(fixtures.notes.every((n) => UUID.test(n.id))).toBe(true);
    expect(new Set(fixtures.clients.map((c) => c.id)).size).toBe(fixtures.clients.length);
    expect(new Set(fixtures.notes.map((n) => n.id)).size).toBe(fixtures.notes.length);
  });

  it('has a demo user with credentials to log in and see the data', () => {
    expect(fixtures.user.email).toMatch(/@/);
    expect(fixtures.user.password.length).toBeGreaterThanOrEqual(8);
  });
});
