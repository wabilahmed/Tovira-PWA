-- 0122_request_steps.sql — [P90 · owner, Prompt 88] The request form is three steps: page_views (0112, owner plane, the
-- same cookieless rules: no IP, the day's hash cleared when the day is over) may also hold a step reached. A step is not
-- a page view and never counts as one. No new column.
ALTER TABLE page_views DROP CONSTRAINT IF EXISTS page_views_page_check;
ALTER TABLE page_views ADD CONSTRAINT page_views_page_check CHECK (page IN ('landing', 'request_access', 'sign_in', 'privacy', 'submitted', 'request_step_1', 'request_step_2', 'request_step_3'));
