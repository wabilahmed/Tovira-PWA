import pg from 'pg';

/**
 * [P87-1 · owner, 25 Nov] A Postgres DATE is a calendar day, not an instant. node-pg's default parser turns it into a
 * JS Date at LOCAL midnight, so on a host east of UTC (Dubai is UTC+4) `toISOString().slice(0, 10)` reads the day
 * before: a promise due 2026-12-01 came back as 2026-11-30. Prod and CI run in UTC, so it never showed there; this
 * makes it impossible anywhere: every pool built by createPool (the API, the migration runner, every owner-run
 * script) parses DATE and DATE[] as the plain 'YYYY-MM-DD' text Postgres sent, and `pgDay` reads either shape
 * correctly (a raw pool that kept the default parser still gets the right day: it reads the local calendar fields).
 */
export const DATE_OID = 1082;
export const DATE_ARRAY_OID = 1182;
const TEXT_ARRAY_OID = 1009;

const identity = (v: string): string => v;
const parserOf = pg.types.getTypeParser as unknown as (oid: number, format?: 'text' | 'binary') => (v: string) => unknown;
const textArray = parserOf(TEXT_ARRAY_OID);

/** Type parsers for a pg Pool/Client: DATE and DATE[] stay text; everything else as node-pg's defaults. */
export const pgTypes = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (oid === DATE_OID) return identity;
    if (oid === DATE_ARRAY_OID) return textArray;
    return parserOf(oid, format ?? 'text');
  },
} as pg.CustomTypesConfig;

const pad = (n: number): string => String(n).padStart(2, '0');

/** A DATE column's value as 'YYYY-MM-DD' (null stays null), whether it arrived as text or as node-pg's local-midnight Date. */
export function pgDay(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  return String(v).slice(0, 10);
}
