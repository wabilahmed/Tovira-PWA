/**
 * Cache-tier advisor (CACHE-TRACK). Decides whether the extraction prompt cache
 * should run on the 5-minute or the 1-hour tier — a purely economic call that
 * depends on how far apart extraction calls land (the cache is org-scoped, so the
 * whole stream shares one prefix entry).
 *
 * The trick: from the SAME recorded timestamps we can simulate BOTH tiers — a
 * call is a cache WRITE (miss) if it lands after the previous touch + TTL, else a
 * READ (hit); every touch refreshes the window. Then we price each tier and
 * recommend the cheaper one. Pure + deterministic — all IO lives in the CLI.
 */
import type { CacheTtl } from '../../ports/model.js';

const MIN = 60_000;
export const TIER_TTL_MS: Record<CacheTtl, number> = { '5m': 5 * MIN, '1h': 60 * MIN };
/** Anthropic multipliers on the base input-token price. Reads are 0.1× either
 *  tier; the write premium is what differs (and what a wasted write costs). */
export const WRITE_MULT: Record<CacheTtl, number> = { '5m': 1.25, '1h': 2.0 };
export const READ_MULT = 0.1;
export const UNCACHED_MULT = 1.0;

/** Fallback prefix size when no cache token counts are present (e.g. stub runs).
 *  The real value is derived from observed cache tokens when available. */
export const DEFAULT_PREFIX_TOKENS = 6744;
/** Don't recommend a switch on thin data or a negligible edge. */
export const MIN_SAMPLE = 20;
export const MIN_SAVING_FRACTION = 0.05;
/** Assumed Sonnet input price for the USD projection ($/M tokens). Override in
 *  the CLI; only scales the reported dollar figure, never the recommendation. */
export const DEFAULT_USD_PER_MTOK = 3.0;
const MONTH_MS = 30 * 24 * 60 * MIN;

export interface CacheEvent {
  at: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface TierSim {
  tier: CacheTtl;
  writes: number;
  reads: number;
  /** Prefix-portion cost in base-input-token-equivalents (1 unit = 1 input token at base price). */
  costUnits: number;
}

export interface CacheAdvice {
  calls: number;
  windowMs: number;
  prefixTokens: number;
  /** What actually happened under the tier that produced the data (cross-check). */
  observed: { writes: number; reads: number; uncached: number };
  gap: { p50Ms: number; p90Ms: number; band5to60Pct: number };
  sim: Record<CacheTtl, TierSim>;
  uncachedCostUnits: number;
  currentTier: CacheTtl;
  recommend: CacheTtl;
  switchRecommended: boolean;
  reason: string;
  estMonthlyUsdSaving: number;
}

/** Simulate a tier over sorted call times: miss if past the window, else hit;
 *  each touch (hit OR miss) refreshes the window. */
export function simulateTier(sortedTimes: number[], tier: CacheTtl, prefixTokens: number): TierSim {
  const ttl = TIER_TTL_MS[tier];
  let writes = 0;
  let reads = 0;
  let expiresAt = -Infinity;
  for (const t of sortedTimes) {
    if (t >= expiresAt) writes += 1;
    else reads += 1;
    expiresAt = t + ttl;
  }
  const costUnits = writes * prefixTokens * WRITE_MULT[tier] + reads * prefixTokens * READ_MULT;
  return { tier, writes, reads, costUnits };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx]!;
}

/** Derive the cached prefix size from observed cache tokens (the write/read token
 *  count IS the prefix size), median of non-zero values; fallback to the default. */
function derivePrefixTokens(events: CacheEvent[]): number {
  const sizes = events
    .map((e) => Math.max(e.cacheCreationTokens, e.cacheReadTokens))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (sizes.length === 0) return DEFAULT_PREFIX_TOKENS;
  return sizes[Math.floor(sizes.length / 2)]!;
}

export function adviseCache(
  events: CacheEvent[],
  currentTier: CacheTtl,
  opts: { usdPerMTok?: number } = {},
): CacheAdvice {
  const usdPerMTok = opts.usdPerMTok ?? DEFAULT_USD_PER_MTOK;
  const times = events.map((e) => e.at).sort((a, b) => a - b);
  const prefixTokens = derivePrefixTokens(events);

  // Observed mix under the current tier (a cross-check on the simulation).
  const observed = { writes: 0, reads: 0, uncached: 0 };
  for (const e of events) {
    if (e.cacheCreationTokens > 0) observed.writes += 1;
    else if (e.cacheReadTokens > 0) observed.reads += 1;
    else observed.uncached += 1;
  }

  // Inter-arrival gaps → the 5–60min band is exactly where 1h reads but 5m rewrites.
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i]! - times[i - 1]!);
  const gapsAsc = [...gaps].sort((a, b) => a - b);
  const band = gaps.filter((g) => g > TIER_TTL_MS['5m'] && g <= TIER_TTL_MS['1h']).length;
  const gap = {
    p50Ms: percentile(gapsAsc, 50),
    p90Ms: percentile(gapsAsc, 90),
    band5to60Pct: gaps.length ? band / gaps.length : 0,
  };

  const sim: Record<CacheTtl, TierSim> = {
    '5m': simulateTier(times, '5m', prefixTokens),
    '1h': simulateTier(times, '1h', prefixTokens),
  };
  const uncachedCostUnits = times.length * prefixTokens * UNCACHED_MULT;

  // Cheaper tier wins; ties (and near-ties) favour 5m — the lower write premium.
  const recommend: CacheTtl = sim['1h'].costUnits < sim['5m'].costUnits ? '1h' : '5m';
  const other: CacheTtl = recommend === '1h' ? '5m' : '1h';
  const savingUnits = sim[other].costUnits - sim[recommend].costUnits;
  const savingFraction = sim[other].costUnits > 0 ? savingUnits / sim[other].costUnits : 0;

  const enoughData = events.length >= MIN_SAMPLE;
  const worthIt = savingFraction >= MIN_SAVING_FRACTION;
  const switchRecommended = enoughData && worthIt && recommend !== currentTier;

  const windowMs = times.length >= 2 ? times[times.length - 1]! - times[0]! : 0;
  // Project the current→recommended delta to a month (0 if current is already best).
  const currentVsRecommend = Math.max(0, sim[currentTier].costUnits - sim[recommend].costUnits);
  const perMs = windowMs > 0 ? currentVsRecommend / windowMs : 0;
  const estMonthlyUsdSaving = (perMs * MONTH_MS * usdPerMTok) / 1_000_000;

  // Name the ACTUAL driver of the win. Recommending 1h → it converts 5m's band
  // re-writes into 0.1× reads (fewer writes). Recommending 5m → both tiers make
  // the same writes, so the win is purely 5m's lower write premium (1.25× vs 2×).
  const bandPct = Math.round(gap.band5to60Pct * 100);
  const savePct = Math.round(savingFraction * 100);
  let reason: string;
  if (!enoughData) {
    reason = `Only ${events.length} calls logged (need ≥${MIN_SAMPLE}) — keep ${currentTier} until there's more signal.`;
  } else if (recommend === currentTier) {
    reason = `${currentTier} is already the cheaper tier here (${bandPct}% of gaps fall in the 5–60min band).`;
  } else if (recommend === '1h') {
    reason = `Switch to 1h: ${bandPct}% of gaps are 5–60min apart, so 1h serves them as 0.1× reads instead of 5m's re-writes — ~${savePct}% cheaper on the prefix.`;
  } else {
    reason = `Switch to 5m: only ${bandPct}% of gaps fall in the 5–60min band, so the 1h window rarely earns its 2× write premium — 5m is ~${savePct}% cheaper here.`;
  }

  return {
    calls: events.length,
    windowMs,
    prefixTokens,
    observed,
    gap,
    sim,
    uncachedCostUnits,
    currentTier,
    recommend,
    switchRecommended,
    reason,
    estMonthlyUsdSaving,
  };
}
