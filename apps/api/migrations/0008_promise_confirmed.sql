-- 0008_promise_confirmed.sql — uncertain items await rep confirmation (P1-7).
ALTER TABLE promises ADD COLUMN IF NOT EXISTS confirmed boolean NOT NULL DEFAULT false;
