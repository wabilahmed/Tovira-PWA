/**
 * Cache-tier advisor CLI (CACHE-TRACK): tells you whether extraction should run
 * on the 5-minute or 1-hour prompt-cache tier, from the REAL gap pattern between
 * extraction calls in the log.
 *
 *   set -a; . ./.env; set +a
 *   npm run cache:advise -w apps/api
 *   CACHE_ADVISE_DAYS=14 SONNET_INPUT_USD_PER_MTOK=3 npm run cache:advise -w apps/api
 *
 * Reads only aggregate, non-PII columns (timestamp + cache token counts) across
 * all tenants on the superuser connection.
 */
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { PgCacheStatsRepository } from '../adapters/logs/pg-cache-stats-repository.js';
import { adviseCache, MIN_SAMPLE } from '../services/cache/cache-advisor.js';

const fmtDur = (ms: number): string => {
  const m = ms / 60_000;
  if (m < 60) return `${m.toFixed(0)}m`;
  const h = m / 60;
  return h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
};
const units = (u: number): string => `${(u / 1000).toFixed(1)}k`;

async function main(): Promise<void> {
  const config = loadConfig();
  const days = Number(process.env.CACHE_ADVISE_DAYS ?? 7);
  const usdPerMTok = Number(process.env.SONNET_INPUT_USD_PER_MTOK ?? 3);
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const pool = createPool(config.databaseUrl);
  try {
    const events = await new PgCacheStatsRepository(pool).recentCacheEvents(sinceMs);
    const a = adviseCache(events, config.extractionCacheTtl, { usdPerMTok });

    console.log(`\nCache-tier advisor — last ${days}d  ·  current tier: ${config.extractionCacheTtl}\n`);
    console.log(`  extractions logged : ${a.calls}${a.calls < MIN_SAMPLE ? `  (need ≥${MIN_SAMPLE} for a switch call)` : ''}`);
    if (a.calls > 0) {
      console.log(`  cache prefix       : ~${a.prefixTokens} tokens`);
      console.log(`  observed mix       : ${a.observed.reads} reads · ${a.observed.writes} writes · ${a.observed.uncached} uncached`);
      console.log(`  gaps between calls : p50 ${fmtDur(a.gap.p50Ms)} · p90 ${fmtDur(a.gap.p90Ms)} · ${Math.round(a.gap.band5to60Pct * 100)}% in the 5–60min band`);
      console.log('');
      console.log(`  simulated prefix cost (base-input-token units):`);
      console.log(`    5m : ${units(a.sim['5m'].costUnits)}  (${a.sim['5m'].writes} writes @1.25× · ${a.sim['5m'].reads} reads @0.1×)`);
      console.log(`    1h : ${units(a.sim['1h'].costUnits)}  (${a.sim['1h'].writes} writes @2.0× · ${a.sim['1h'].reads} reads @0.1×)`);
      console.log(`    (uncached baseline: ${units(a.uncachedCostUnits)})`);
      console.log('');
    }
    console.log(`  → recommend: ${a.recommend.toUpperCase()}${a.switchRecommended ? '  ⚠ SWITCH' : '  (no change)'}`);
    console.log(`  ${a.reason}`);
    if (a.switchRecommended) {
      console.log(`  est. saving vs current: ~$${a.estMonthlyUsdSaving.toFixed(2)}/mo (at $${usdPerMTok}/M input tokens)`);
      console.log(`  to switch: set EXTRACTION_CACHE_TTL=${a.recommend} and restart.`);
    }
    console.log('');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
