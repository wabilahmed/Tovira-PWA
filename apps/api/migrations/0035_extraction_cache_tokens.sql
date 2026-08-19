-- 0035_extraction_cache_tokens.sql — record prompt-cache usage per extraction so
-- the cache-tier advisor can tell when 1h vs 5m is cheaper (CACHE-TRACK).
ALTER TABLE extraction_logs ADD COLUMN IF NOT EXISTS cache_creation_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE extraction_logs ADD COLUMN IF NOT EXISTS cache_read_tokens integer NOT NULL DEFAULT 0;
-- The advisor reads recent rows by time across all tenants (ops query on the
-- superuser connection); index created_at for that scan.
CREATE INDEX IF NOT EXISTS extraction_logs_created_at_idx ON extraction_logs(created_at);
