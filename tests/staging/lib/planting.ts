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

// Deterministic benign filler by language — realistic conversational lines that carry
// NO plantable fact (no commitment, no resolvable date, no named person). Varied and
// substantive so a long transcript reads like a real chat rather than degenerate noise
// (degenerate filler makes even a good extractor return empty — a fixture artifact, not
// a model failure).
const FILLER: Record<string, string[]> = {
  en: [
    'sounds good, appreciate the quick turnaround', 'let me look into that on my end', 'that makes sense to me',
    'the demo yesterday went really well I thought', 'their team seemed engaged on the call', 'yeah the weather has been brutal this week',
    'how was your weekend?', 'traffic on the way in was terrible today', 'coffee first, then we talk numbers haha',
    'I think we are aligned on the overall direction', 'good point, I had not considered that angle', 'let me loop back after I sync internally',
    'the office coffee machine is broken again', 'did you catch the match last night?', 'agreed, no rush on this from our side',
    'happy to jump on a quick call if easier', 'thanks for being patient with all the back and forth', 'that works for me either way',
    'lets keep the momentum going', 'totally understand, take your time',
  ],
  arz: [
    'el demo kan helw awi', 'ana fahem 2asdak', 'khalas neshoof ba3d el ijaza', 'el gaw harr gedan el ayam di',
    'ezayak? kollo tamam?', 'el meeting kan mofeed', 'mafeesh mshakel khalis', 'ana ma3ak fel ra2y da',
    'neb2a nkallem ba3den', 'shokran 3ala el sabr', 'el share3 zahma en-naharda', 'tab neshoof',
  ],
  ar: [
    'العرض التقديمي كان ممتازاً أمس', 'أفهم وجهة نظرك تماماً', 'الجو حار جداً هذه الأيام', 'كيف كانت عطلتك؟',
    'الاجتماع كان مفيداً للطرفين', 'لا توجد أي مشكلة من جانبنا', 'أتفق معك في هذا الرأي', 'دعنا نتحدث لاحقاً',
    'شكراً على سعة صدرك', 'الزحام في الطريق كان فظيعاً', 'نتواصل قريباً', 'خذ وقتك، لا استعجال',
  ],
  hi: ['demo bahut accha raha kal', 'main aapki baat samajh gaya', 'mausam bahut garam hai in dino', 'weekend kaisa raha aapka?', 'meeting productive thi', 'humari taraf se koi dikkat nahi', 'main aapse sehmat hoon', 'baad mein baat karte hain', 'dhanyavaad patience ke liye'],
  ur: ['demo kaafi acha raha', 'main samajh gaya aap ki baat', 'mausam bohat garam hai', 'aap ka weekend kaisa tha?', 'meeting mufeed rahi', 'hamari taraf se koi masla nahi', 'main aap se muttafiq hoon', 'baad mein baat karte hain'],
  ru: ['презентация вчера прошла отлично', 'я понимаю вашу мысль', 'жара стоит невыносимая', 'как прошли выходные?', 'встреча была продуктивной', 'с нашей стороны проблем нет', 'согласен с вами', 'спишемся позже'],
  tl: ['ang ganda ng demo kahapon', 'naiintindihan ko ang punto mo', 'ang init ng panahon ngayon', 'kumusta ang weekend mo?', 'productive ang meeting', 'walang problema sa amin', 'sang-ayon ako sa iyo', 'usap tayo mamaya'],
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
