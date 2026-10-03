-- 0081_ai_display_exhausted.sql — [USAGE-ALLOWANCE sticky exhaustion]
--
-- Once a call is refused for insufficient allowance in a window, the account is treated as exhausted
-- FOR DISPLAY (meter 100% + paused banner) even if settled spend is below the allowance, because the
-- worst-case estimate over-locks headroom. Cleared by a top-up; reset by a new window (a fresh row
-- defaults false).
ALTER TABLE ai_usage_month ADD COLUMN IF NOT EXISTS display_exhausted boolean NOT NULL DEFAULT false;
