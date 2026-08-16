-- 0031_consent_version.sql — record WHICH policy version the rep agreed to at
-- signup (P5-4). consent_at already exists (0017); this stores the version too,
-- so consent is auditable ("agreed to v2026-08-01 at <timestamp>").
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_version text;
