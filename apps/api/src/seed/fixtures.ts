/**
 * Realistic, deterministic seed fixtures (P0-6). Fixed UUIDs make re-seeding
 * idempotent. Notes carry extracted facts in the v0.1 extraction shape so the
 * downstream features (brief, promises tracker) have representative data.
 */

export interface ExtractedFacts {
  promises: Array<{ text: string; owner: 'rep' | 'client'; due_raw: string | null; due_date: string | null; confidence: 'high' | 'medium' | 'low' }>;
  people: Array<{ name: string; role?: string; decision_role?: 'decision_maker' | 'influencer' | 'blocker' | 'unknown' }>;
  personal_facts: Array<{ subject: string; fact: string }>;
  concerns: Array<{ text: string }>;
  meeting: { datetime_raw: string; confirmed: boolean } | null;
  next_steps: string[];
  summary: string;
}

export interface SeedClient {
  id: string;
  name: string;
}

export interface SeedNote {
  id: string;
  clientId: string;
  source: 'voice' | 'paste';
  rawText: string;
  extracted: ExtractedFacts;
}

const CLIENT = {
  meridian: 'aaaaaaaa-0000-4000-8000-000000000001',
  northwind: 'aaaaaaaa-0000-4000-8000-000000000002',
  acme: 'aaaaaaaa-0000-4000-8000-000000000003',
  blueHarbor: 'aaaaaaaa-0000-4000-8000-000000000004',
};

const clients: SeedClient[] = [
  { id: CLIENT.meridian, name: 'Meridian Corp' },
  { id: CLIENT.northwind, name: 'Northwind Trading' },
  { id: CLIENT.acme, name: 'Acme Health' },
  { id: CLIENT.blueHarbor, name: 'Blue Harbor Logistics' },
];

const empty = { promises: [], people: [], personal_facts: [], concerns: [], meeting: null, next_steps: [], summary: '' };

const notes: SeedNote[] = [
  {
    id: 'bbbbbbbb-0000-4000-8000-000000000001',
    clientId: CLIENT.meridian,
    source: 'voice',
    rawText:
      "Had coffee with Sarah from Meridian this morning. She's worried the Q3 rollout timeline is too tight. I promised to send the revised proposal by Friday. Her son just started at Stanford, she was really proud.",
    extracted: {
      ...empty,
      promises: [{ text: 'send the revised proposal', owner: 'rep', due_raw: 'Friday', due_date: null, confidence: 'high' }],
      people: [{ name: 'Sarah', role: 'Ops lead', decision_role: 'influencer' }],
      personal_facts: [{ subject: 'Sarah', fact: 'Son just started at Stanford' }],
      concerns: [{ text: 'Q3 rollout timeline feels too tight' }],
      summary: 'Coffee with Sarah; she is worried about the Q3 timeline. Promised the revised proposal by Friday.',
    },
  },
  {
    id: 'bbbbbbbb-0000-4000-8000-000000000002',
    clientId: CLIENT.meridian,
    source: 'paste',
    rawText:
      'Sarah (WhatsApp): Thanks for today! Confirming we are on for next Tuesday at 3pm with the wider team. Please bring the updated pricing 🙏',
    extracted: {
      ...empty,
      people: [{ name: 'Sarah', decision_role: 'influencer' }],
      meeting: { datetime_raw: 'next Tuesday at 3pm', confirmed: false },
      next_steps: ['Bring updated pricing to Tuesday meeting'],
      summary: 'Sarah confirmed a wider-team meeting next Tuesday 3pm; wants updated pricing.',
    },
  },
  {
    id: 'bbbbbbbb-0000-4000-8000-000000000003',
    clientId: CLIENT.northwind,
    source: 'voice',
    rawText:
      "Call with Jordan, the VP of Operations at Northwind. He's the one who signs off on this. Budget got approved for next quarter and he wants a full demo before committing. Sounded genuinely keen.",
    extracted: {
      ...empty,
      people: [{ name: 'Jordan', role: 'VP of Operations', decision_role: 'decision_maker' }],
      concerns: [],
      next_steps: ['Schedule a full product demo for Jordan'],
      summary: 'Jordan (VP Ops, decision maker) has budget approved and wants a full demo before committing.',
    },
  },
  {
    id: 'bbbbbbbb-0000-4000-8000-000000000004',
    clientId: CLIENT.acme,
    source: 'voice',
    rawText:
      "Dinner with Tom from Acme Health. Mostly relationship building. His wife's birthday is coming up next month and he's planning a trip to Portugal. Big golfer. No business asks tonight.",
    extracted: {
      ...empty,
      people: [{ name: 'Tom', role: 'Procurement', decision_role: 'unknown' }],
      personal_facts: [
        { subject: "Tom's wife", fact: 'Birthday next month' },
        { subject: 'Tom', fact: 'Keen golfer; planning a trip to Portugal' },
      ],
      summary: 'Relationship dinner with Tom; personal notes only, no business asks.',
    },
  },
  {
    id: 'bbbbbbbb-0000-4000-8000-000000000005',
    clientId: CLIENT.acme,
    source: 'paste',
    rawText:
      "Tom (email): Legal sent back redlines on the contract. Main sticking point is the SLA — they want 99.9% uptime guaranteed. Can we get on a call this week to work through it?",
    extracted: {
      ...empty,
      people: [{ name: 'Tom', decision_role: 'unknown' }],
      concerns: [{ text: 'SLA redline — wants 99.9% uptime guarantee' }],
      meeting: { datetime_raw: 'this week', confirmed: false },
      next_steps: ['Set up a call to work through the SLA redlines'],
      summary: 'Acme legal returned contract redlines; SLA uptime is the sticking point. Tom wants a call this week.',
    },
  },
  {
    id: 'bbbbbbbb-0000-4000-8000-000000000006',
    clientId: CLIENT.blueHarbor,
    source: 'voice',
    rawText:
      "Site visit at Blue Harbor's main warehouse. Met Priya, the warehouse manager — sharp, clearly influential on the floor. The real blocker is IT integration; their systems are ancient. I said I'd loop in our solutions engineer by end of week.",
    extracted: {
      ...empty,
      promises: [{ text: 'loop in our solutions engineer', owner: 'rep', due_raw: 'end of week', due_date: null, confidence: 'high' }],
      people: [{ name: 'Priya', role: 'Warehouse manager', decision_role: 'influencer' }],
      concerns: [{ text: 'IT integration with legacy systems is the main blocker' }],
      summary: 'Blue Harbor site visit; met Priya. IT integration is the blocker. Promised to loop in a solutions engineer by end of week.',
    },
  },
];

export const fixtures = {
  user: { email: 'demo@tovira.local', password: 'demo-password-123' },
  clients,
  notes,
};
