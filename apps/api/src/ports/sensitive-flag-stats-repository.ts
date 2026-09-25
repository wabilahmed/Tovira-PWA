/**
 * [SCREEN-REVIEW · RESTORE-SIGNAL] Aggregate store of how often a rep restores a held sensitive flag,
 * keyed ONLY by (category, matched span). It deliberately holds NO userId, note id, client id, or message
 * content — the signal is aggregate and not attributable to a rep or their book. Its sole purpose is to
 * measure detector false positives from the person best placed to judge them (a rep restoring a flag).
 * It is NOT a corpus: no flagged passages are stored under any scheme.
 */
export interface SensitiveFlagRestoreStat {
  category: string;
  span: string;
  restored: number;
}

export interface SensitiveFlagStatsRepository {
  /** Count one restore of a (category, span) flag. Takes no identifier — attribution is impossible by design. */
  recordRestore(category: string, span: string): Promise<void>;
  /** The aggregate counts, for reviewing detector false positives. */
  list(): Promise<SensitiveFlagRestoreStat[]>;
}
