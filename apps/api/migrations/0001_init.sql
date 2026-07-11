-- 0001_init.sql — enable pgvector (the semantic-search substrate for the "messy pile").
-- Tenant tables with user_id + Row-Level Security arrive in P0-4.
CREATE EXTENSION IF NOT EXISTS vector;
