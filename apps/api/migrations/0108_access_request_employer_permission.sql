-- 0108_access_request_employer_permission.sql — [P59-1 · owner] A hot lead invited by the founder is approved at once (no
-- NOC wait). One who says they are employed must also tick "I have my employer's permission to use Tovira with their
-- clients' information." The exact wording they ticked and when are kept with the request, as the confirmation is.
-- Null for everyone else (owners, public requests, requests made before this). Same table, same grants (0073).
ALTER TABLE access_requests
  ADD COLUMN IF NOT EXISTS employer_permission_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS employer_permission_text        text;
ALTER TABLE access_requests DROP CONSTRAINT IF EXISTS access_requests_employer_permission_pair;
ALTER TABLE access_requests ADD CONSTRAINT access_requests_employer_permission_pair
  CHECK ((employer_permission_accepted_at IS NULL) = (employer_permission_text IS NULL));
