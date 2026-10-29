-- 0106_client_company_industry.sql — [P57-3 · owner] A rep adding a client they just met types the company and picks
-- the industry. Industry uses the sign-up form's list (0095), so a rep's clients line up with the segment data. Both
-- are optional and nullable: existing clients stay NULL (nothing is guessed). Same row, same RLS as clients.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS industry text
    CONSTRAINT clients_industry_check
    CHECK (industry IS NULL OR industry IN ('insurance', 'wealth_private_banking', 'b2b_key_accounts', 'luxury_client_advisory', 'recruitment', 'property', 'other'));
