import type { ModelClient } from '../../ports/model.js';
import { extractJsonObject } from '../extraction/parse.js';

/**
 * [ASK-CAPTURE stage 1: DETECT] Classify whether a rep's Ask turn is a FACTUAL STATEMENT about a
 * client — versus a question, hypothetical, or speculation. Detection only: it extracts nothing and
 * writes nothing. Conservative by construction — "questions must never become facts", so anything
 * that isn't unambiguously a statement about a clearly-named client is NOT flagged (when in doubt,
 * do not flag). This runs on the cheap recall model; the certified engine does the actual extraction.
 */
export interface DetectedStatement {
  isStatement: boolean;
  /** The rep's verbatim turn (what a receipt must quote), never a paraphrase. */
  text: string;
  /** The client the statement is about — a name from the book, or null when not clearly one. */
  clientRef: string | null;
}

export interface StatementDetector {
  detect(turn: string, clientNames: string[]): Promise<DetectedStatement>;
}

const DETECT_SYSTEM = `You decide whether a salesperson's message is them STATING A FACT about a client (something that happened or is true), or NOT (a question, a hypothetical, speculation, or small talk).
Questions ("did he say...", "what did they want", "should I...", "what if..."), and anything uncertain, are NOT statements.
If — and only if — it is a clear factual statement, identify which client it is about, choosing an exact name from the CLIENTS list; if no client from the list is clearly the subject, use null.
Output ONLY JSON: {"isStatement": true|false, "clientRef": "<exact client name>"|null}`;

/** The always-safe answer — used on any uncertainty or parse failure (never flag by accident). */
function notAStatement(turn: string): DetectedStatement {
  return { isStatement: false, text: turn, clientRef: null };
}

export class ModelStatementDetector implements StatementDetector {
  constructor(private readonly model: ModelClient) {}

  async detect(turn: string, clientNames: string[]): Promise<DetectedStatement> {
    if (!turn.trim()) return notAStatement(turn);
    try {
      const res = await this.model.complete({
        system: DETECT_SYSTEM,
        messages: [{ role: 'user', content: `CLIENTS: ${clientNames.join(', ') || '(none)'}\nMESSAGE: ${turn}` }],
        maxTokens: 120,
      });
      const obj = extractJsonObject(res.text) as { isStatement?: unknown; clientRef?: unknown } | null;
      if (!obj || obj.isStatement !== true) return notAStatement(turn); // default to NOT a statement
      const clientRef = typeof obj.clientRef === 'string' && obj.clientRef.trim() ? obj.clientRef.trim() : null;
      return { isStatement: true, text: turn, clientRef };
    } catch {
      return notAStatement(turn); // a detection failure must never fabricate a capture
    }
  }
}
