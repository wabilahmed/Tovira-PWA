-- 0095_access_request_industry.sql — [P42-A6] The beta request form asks which industry the rep sells in, so the
-- owner can see which segments sign up. Required on NEW requests (the API validates it); additive and nullable here,
-- so requests made before it stay NULL and read "Not given" (no backfill: nobody's industry is guessed).
-- industry_other carries the free text for 'other' only, mirroring conversation_ownership_other.
ALTER TABLE access_requests
  ADD COLUMN IF NOT EXISTS industry text
    CONSTRAINT access_requests_industry_check
    CHECK (industry IS NULL OR industry IN ('insurance', 'wealth_private_banking', 'b2b_key_accounts', 'luxury_client_advisory', 'recruitment', 'property', 'other')),
  ADD COLUMN IF NOT EXISTS industry_other text
    CONSTRAINT access_requests_industry_other_only_when_other
    CHECK (industry = 'other' OR industry_other IS NULL);
