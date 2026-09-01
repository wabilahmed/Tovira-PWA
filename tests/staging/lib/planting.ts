/**
 * Planting generator for the Sonnet/Haiku bake-off (Part 2). Ground truth is by
 * CONSTRUCTION: you declare the facts to plant (promises, people, dates, traps), the
 * generator renders them into a WhatsApp-export transcript padded with deterministic
 * multilingual filler to a target size, and the answer key is derived from the plants —
 * never hand-transcribed from generated text. Deterministic given the spec (fixed
 * filler rotation + pinned timestamps), so a re-run is byte-identical.
 *
 * WhatsApp line format: `[DD/MM/YYYY, HH:MM:SS] Sender: message`.
 */

export interface PlantedPromise {
  text: string; // the commitment, as the answer key expects it
  owner: 'rep' | 'client';
  dueDate: string | null; // resolved YYYY-MM-DD, or null when unresolvable/ambiguous
  dueRaw: string | null;
  confidence: 'high' | 'low';
  line: string; // the transcript line that carries it (sender+message rendered around it)
  sender: string;
}
export interface PlantedPerson {
  name: string;
  line: string;
  sender: string;
}
export interface PlantedKeyDate {
  description: string;
  date: string | null;
  dateRaw: string | null;
  line: string;
  sender: string;
}
export interface Trap {
  kind: string; // 'ambiguous-date' | 'no-merge' | 'supersession' | 'conditional' | 'negation' | 'third-party' | 'needle' | 'near-duplicate' | 'deleted' | 'media' | 'unanswered' | 'role-only'
  note: string; // what the correct behaviour is (for the answer key + report)
}

export interface ExportSpec {
  id: string; // 'export-1' .. 'export-5'
  today: string; // pinned YYYY-MM-DD for relative-date resolution
  approxLines: number;
  languages: string[];
  fillerLangs: string[]; // languages the benign filler draws from
  promises: PlantedPromise[];
  people: PlantedPerson[];
  keyDates: PlantedKeyDate[];
  traps: Trap[];
  needleAtLine?: number; // export 5: a fact to recall from deep in the transcript
  certifiedLanguages: string[]; // which languages count toward pass/fail (RU/TL are uncertified)
  /** Trap lines that carry NO promotable fact (negation, unanswered question, deleted,
   *  media) — planted so the model is actually exercised on them, but absent from the key. */
  extraLines?: Array<{ sender: string; message: string }>;
}

export interface AnswerKey {
  id: string;
  today: string;
  promises: Array<Pick<PlantedPromise, 'text' | 'owner' | 'dueDate' | 'dueRaw' | 'confidence'>>;
  people: string[];
  keyDates: Array<Pick<PlantedKeyDate, 'description' | 'date' | 'dateRaw'>>;
  /** Hard trust rules that MUST hold (any violation disqualifies a model). */
  trustRules: {
    fabricatedPromises: 0;
    guessedDates: 0;
    mergedPeople: 0;
    nullNamedPeople: 0;
    falseCertainties: 0;
  };
  traps: Trap[];
  needle?: { atLine: number; fact: string };
  uncertifiedLanguages: string[];
}

// Deterministic benign filler by language — none of these carry a plantable fact.
const FILLER: Record<string, string[]> = {
  en: ['sounds good', 'ok thanks', 'let me check and revert', 'great, appreciate it', 'noted', 'will do', 'talk soon', 'haha yeah', 'makes sense', 'on it'],
  arz: ['tamam', 'inshallah', 'akeed', 'meshy keda', 'shukran', 'wa2t eh?', 'tab tayeb', 'zabt'],
  ar: ['تمام', 'إن شاء الله', 'شكراً', 'ماشي', 'حاضر', 'تسلم', 'أوكي', 'طيب'],
  hi: ['theek hai', 'haan ji', 'accha', 'dhanyavaad', 'ho jayega', 'zaroor'],
  ur: ['theek hai', 'jee haan', 'shukriya', 'bilkul', 'ho jayega ga'],
  ru: ['хорошо', 'спасибо', 'договорились', 'понял', 'ок', 'до связи'],
  tl: ['sige', 'salamat', 'okay lang', 'oo naman', 'ingat', 'game'],
};
const SENDERS = ['Me', 'Client'];

function pad2(n: number): string { return String(n).padStart(2, '0'); }

/** Render one WhatsApp line at a deterministic timestamp derived from the index. */
function line(spec: ExportSpec, idx: number, sender: string, message: string): string {
  const [y, m, d] = spec.today.split('-').map(Number) as [number, number, number];
  const hh = 8 + (idx % 12);
  const mm = idx % 60;
  const ss = (idx * 7) % 60;
  return `[${pad2(d)}/${pad2(m)}/${y}, ${pad2(hh)}:${pad2(mm)}:${pad2(ss)}] ${sender}: ${message}`;
}

/**
 * Render the full transcript + derive the answer key. Planted fact-lines are placed at
 * spread positions (and the needle near its target line); everything else is filler.
 */
export function generateExport(spec: ExportSpec): { text: string; answerKey: AnswerKey } {
  const planted: Array<{ sender: string; message: string }> = [
    ...spec.promises.map((p) => ({ sender: p.sender, message: p.line })),
    ...spec.people.map((p) => ({ sender: p.sender, message: p.line })),
    ...spec.keyDates.map((k) => ({ sender: k.sender, message: k.line })),
    ...(spec.extraLines ?? []),
  ];
  const total = Math.max(spec.approxLines, planted.length + 1);
  const langs = spec.fillerLangs;
  const lines: string[] = [];
  // Spread planted lines evenly; needle (if any) forced near its target line.
  const step = Math.floor(total / (planted.length + 1)) || 1;
  const plantedAt = new Map<number, { sender: string; message: string }>();
  planted.forEach((p, i) => plantedAt.set(Math.min((i + 1) * step, total - 1), p));
  if (spec.needleAtLine !== undefined) {
    plantedAt.set(spec.needleAtLine, { sender: 'Client', message: `by the way, our office moved to Sheikh Zayed Road, tower 3 — needle-${spec.id}` });
  }
  for (let i = 0; i < total; i++) {
    const p = plantedAt.get(i);
    if (p) {
      lines.push(line(spec, i, p.sender, p.message));
    } else {
      const lang = langs[i % langs.length]!;
      const bank = FILLER[lang] ?? FILLER.en!;
      lines.push(line(spec, i, SENDERS[i % 2]!, bank[i % bank.length]!));
    }
  }
  const [hy, hm, hd] = spec.today.split('-').map(Number) as [number, number, number];
  const text =
    `[${pad2(hd)}/${pad2(hm)}/${hy}, 07:59:00] Me: Messages and calls are end-to-end encrypted.\n` +
    lines.join('\n');

  // Dedupe the answer-key promises by owner + normalized text: a near-duplicate
  // commitment planted twice is ONE promise in the key (extraction must not double it).
  const seen = new Set<string>();
  const keyPromises = spec.promises
    .map((p) => ({ text: p.text, owner: p.owner, dueDate: p.dueDate, dueRaw: p.dueRaw, confidence: p.confidence }))
    .filter((p) => {
      const k = `${p.owner} ${p.text.trim().toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  const answerKey: AnswerKey = {
    id: spec.id,
    today: spec.today,
    promises: keyPromises,
    people: spec.people.map((p) => p.name),
    keyDates: spec.keyDates.map((k) => ({ description: k.description, date: k.date, dateRaw: k.dateRaw })),
    trustRules: { fabricatedPromises: 0, guessedDates: 0, mergedPeople: 0, nullNamedPeople: 0, falseCertainties: 0 },
    traps: spec.traps,
    ...(spec.needleAtLine !== undefined ? { needle: { atLine: spec.needleAtLine, fact: `office moved to Sheikh Zayed Road, tower 3` } } : {}),
    uncertifiedLanguages: spec.languages.filter((l) => !spec.certifiedLanguages.includes(l)),
  };
  return { text, answerKey };
}
