-- 0001_init.sql — enable the extensions the schema relies on.
--  - vector: the semantic-search substrate for the "messy pile".
--  - pgcrypto: gen_random_bytes() for the opaque referral code (used in 0028).
--    (gen_random_uuid() is core in PG13+, but gen_random_bytes() is not.)
-- Tenant tables with user_id + Row-Level Security arrive in P0-4.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
