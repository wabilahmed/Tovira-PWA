-- [P86 · index audit] Seed for db/query-plans.guard.test.ts. The audit itself ran on 200 reps x 100 clients with 2M
-- chat messages; this is the same shape scaled to 40 reps x 50 clients so CI seeds in seconds. Every table that grows
-- with usage gets thousands of rows, enough that a query with no usable index plans a sequential scan. Run as the
-- database owner; FK triggers are skipped for speed (ids are generated consistently).
SELECT setseed(0.42);
SET session_replication_role = replica;

CREATE TEMP TABLE u AS SELECT gen_random_uuid() AS id, g AS n FROM generate_series(1, 40) g;
INSERT INTO users (id, email, password_hash, referral_code, created_at, timezone, email_verified)
SELECT id, 'rep' || n || '@example.test', 'x', 'ref' || n, now() - (n || ' days')::interval, 'Asia/Dubai', true FROM u;
INSERT INTO subscriptions (user_id, status, trial_ends_at, stripe_customer_id, current_period_end)
SELECT id, CASE WHEN n % 5 = 0 THEN 'trialing' ELSE 'active' END, now() + interval '7 days', 'cus_' || n, now() + interval '20 days' FROM u;
-- accounts with no book yet (most sign-ups), so users and subscriptions are as large as they get
INSERT INTO users (id, email, password_hash, referral_code, created_at, timezone, email_verified)
SELECT gen_random_uuid(), 'idle' || g || '@example.test', 'x', 'idle' || g, now() - (g || ' hours')::interval, 'Asia/Dubai', g % 2 = 0 FROM generate_series(1, 3000) g;
INSERT INTO subscriptions (user_id, status, trial_ends_at, stripe_customer_id, current_period_end)
SELECT id, CASE WHEN referral_code LIKE 'idle%7' THEN 'trialing' ELSE 'canceled' END, now() + interval '7 days', 'cus_' || referral_code, now() + interval '20 days'
  FROM users WHERE referral_code LIKE 'idle%';

CREATE TEMP TABLE c AS SELECT gen_random_uuid() AS id, u.id AS user_id, u.n AS un, g AS cn FROM u, generate_series(1, 50) g;
INSERT INTO clients (id, user_id, name, created_at, last_touched_at, outcome, outcome_source, outcome_changed_at, lead_status, company, industry)
SELECT id, user_id, 'Client ' || un || '-' || cn, now() - (cn || ' days')::interval, now() - ((cn % 60) || ' days')::interval,
  CASE WHEN cn % 10 = 0 THEN 'won' ELSE 'open' END, CASE WHEN cn % 10 = 0 THEN 'rep' END, CASE WHEN cn % 10 = 0 THEN now() END,
  (ARRAY['warm','cold','done'])[1 + cn % 3], 'Co ' || cn, 'property' FROM c;

CREATE TEMP TABLE nt AS SELECT gen_random_uuid() AS id, c.user_id, c.id AS client_id, g AS k FROM c, generate_series(1, 3) g;
INSERT INTO notes (id, user_id, client_id, source, raw_text, extracted, created_at, status, messages, captured_at, settled_at, embedding)
SELECT nt.id, nt.user_id, nt.client_id, CASE WHEN k = 3 THEN 'voice' ELSE 'whatsapp_export' END,
  'chat line about the deal', '{"summary":"s","promises":[],"people":[]}'::jsonb, now() - (k * 9 || ' days')::interval,
  CASE WHEN random() < 0.02 THEN 'pending_extraction' WHEN random() < 0.01 THEN 'extracting' ELSE 'extracted' END,
  (SELECT jsonb_agg(jsonb_build_object('at', (now() - (m || ' hours')::interval)::text, 'sender', CASE WHEN m % 2 = 0 THEN 'Me' ELSE 'Client' END, 'text', 'message ' || m || ' ' || nt.k))
     FROM generate_series(1, 5) m),
  now() - (k * 9 || ' days')::interval, now() - (k * 9 || ' days')::interval, NULL
FROM nt;

INSERT INTO promises (user_id, note_id, client_id, text, owner, due_date, due_raw, confidence, done, created_at, confirmed, done_at, source_span)
SELECT nt.user_id, nt.id, nt.client_id, 'Send the revised quote ' || g, CASE WHEN g = 2 THEN 'client' ELSE 'rep' END,
  current_date + ((random() * 60)::int - 30), 'Thursday', CASE WHEN g = 3 THEN 'low' ELSE 'high' END,
  random() < 0.6, now() - (nt.k * 9 || ' days')::interval, true, CASE WHEN random() < 0.6 THEN now() END, 'I will send it'
FROM nt, generate_series(1, 3) g;
INSERT INTO key_dates (user_id, note_id, client_id, description, date, date_raw, type, created_at)
SELECT user_id, id, client_id, 'Launch', current_date + (random() * 300)::int, 'March 3rd', 'launch', now() FROM nt;
INSERT INTO meetings (user_id, client_id, note_id, datetime, datetime_raw, title, confirmed, created_at)
SELECT user_id, client_id, id, now() + ((random() * 40 - 20) || ' days')::interval, 'Thursday 3pm', 'Demo', random() < 0.5, now() FROM nt WHERE random() < 0.7;
INSERT INTO requirements (user_id, note_id, client_id, text, requirement_raw, stated_on, confidence, status, created_at, last_mentioned_at)
SELECT user_id, id, client_id, 'A 2-bed near the marina', 'looking for a 2-bed', current_date - k * 9, 'high',
  (ARRAY['open','open','met','dormant'])[1 + (random() * 3)::int], now() - (k * 9 || ' days')::interval, now() FROM nt;

INSERT INTO corrections (user_id, note_id, entity_type, entity_id, field, verdict, created_at, prompt_version)
SELECT user_id, id, 'promise', gen_random_uuid(), 'text', 'confirm', now(), 'tovira-extract-v0.9.7' FROM nt WHERE random() < 0.5;
INSERT INTO extraction_logs (user_id, note_id, prompt_version, model, status, input_tokens, output_tokens, latency_ms, created_at)
SELECT user_id, id, 'tovira-extract-v0.9.7', 'claude-sonnet-5', 'ok', 4000, 600, 9000, now() - (k || ' days')::interval FROM nt;
INSERT INTO ai_message_charge (note_id, user_id, period_key, messages, created_at) SELECT id, user_id, 'm:2026-11', 20, now() FROM nt;

INSERT INTO notifications (user_id, type, dedupe_key, client_id, title, body, read, created_at)
SELECT user_id, (ARRAY['overdue','due_today','nudge','going_cold','date_reminder'])[1 + g], 'k' || g || ':' || id, client_id, 't', 'b', random() < 0.7, now() - (g || ' days')::interval
FROM nt, generate_series(0, 4) g WHERE nt.k = 1;
INSERT INTO ledger_events (user_id, client_id, type, source_id, dedupe_key, occurred_at)
SELECT user_id, id, 'won', id::text, 'won:' || id || ':' || g, now() - (g || ' days')::interval FROM c, generate_series(1, 2) g;
INSERT INTO client_aliases (user_id, client_id, alias, kind) SELECT user_id, id, 'alias ' || cn, 'learned' FROM c;
INSERT INTO client_pointers (user_id, client_id, pointers) SELECT user_id, id, '[]'::jsonb FROM c;
INSERT INTO client_deal_values (user_id, client_id, aed) SELECT user_id, id, 1000 FROM c;
INSERT INTO client_outcome_history (user_id, client_id, prev_outcome, new_outcome, source, changed_at) SELECT user_id, id, 'open', 'won', 'rep', now() FROM c;
INSERT INTO client_name_history (user_id, client_id, old_name, new_name, changed_at) SELECT user_id, id, 'Old ' || cn, 'Client ' || cn, now() FROM c;
INSERT INTO going_quiet_alerts (user_id, client_id, quiet_since, silent_days, reached_at, reached_via) SELECT user_id, id, now() - interval '30 days', 30, now(), 'today' FROM c;
INSERT INTO person_link_questions (user_id, client_id, note_id, person_name, person_key, quote, status)
SELECT nt.user_id, nt.client_id, nt.id, 'Omar', 'omar:' || nt.id, 'q', 'pending' FROM nt WHERE random() < 0.5;
INSERT INTO promise_kept_suggestions (user_id, client_id, note_id, promise_key, promise_owner, promise_text, delivery_at, delivery_body, status)
SELECT user_id, client_id, id, 'pk:' || id, 'rep', 'Send it', now()::text, 'Sent the quote', (ARRAY['open','dismissed','accepted'])[1 + (random() * 2)::int] FROM nt WHERE random() < 0.5;
INSERT INTO images (user_id, client_id, storage_key, content_type) SELECT user_id, id, 'img/' || id, 'image/jpeg' FROM c;

CREATE TEMP TABLE inv AS SELECT gen_random_uuid() AS id, u.id AS user_id, g FROM u, generate_series(1, 60) g;
INSERT INTO inventory_items (id, user_id, title, description, quantity, status, disabled_reason)
SELECT id, user_id, 'Unit ' || g, 'desc', 3, CASE WHEN g % 10 = 0 THEN 'disabled' ELSE 'active' END, CASE WHEN g % 10 = 0 THEN 'sold_out' END FROM inv;
INSERT INTO inventory_matches (user_id, requirement_id, item_id, client_id, similarity, confidence, status)
SELECT r.user_id, r.id, i.id, r.client_id, 0.8, 'strong', CASE WHEN random() < 0.7 THEN 'open' ELSE 'dismissed' END
FROM (SELECT *, row_number() OVER (PARTITION BY user_id ORDER BY id) rn FROM requirements) r JOIN inv i ON i.user_id = r.user_id AND i.g = 1 + r.rn % 60;
INSERT INTO inventory_shares (user_id, item_id, client_id, outcome, outcome_set_by, match_id)
SELECT user_id, item_id, client_id, 'pending', 'rep', id FROM inventory_matches WHERE random() < 0.6;

INSERT INTO recall_sessions (id, user_id, created_at, last_activity_at)
SELECT gen_random_uuid(), id, now() - (g || ' days')::interval, now() - (g || ' days')::interval FROM u, generate_series(1, 50) g;
INSERT INTO recall_messages (user_id, session_id, role, content, created_at)
SELECT s.user_id, s.id, CASE WHEN g % 2 = 0 THEN 'user' ELSE 'assistant' END, 'what did Omar want', s.created_at + (g || ' minutes')::interval FROM recall_sessions s, generate_series(1, 4) g;
INSERT INTO recall_daily (user_id, day, count) SELECT id::text, (current_date - g)::text, 5 FROM u, generate_series(0, 60) g;

INSERT INTO model_call_events (user_id, period_key, spend_class, model, input_tokens, output_tokens, thinking_tokens, cache_read_tokens, cache_creation_tokens, cache_hit, cost_aed, created_at, conversation_id, turn_index)
SELECT user_id::text, 'm:2026-' || lpad((1 + g % 11)::text, 2, '0'), (ARRAY['extraction','import','recall','pointers'])[1 + g % 4], 'claude-sonnet-5', 4000, 600, 300, 3000, 0, true, 0.05,
  now() - (g || ' hours')::interval, CASE WHEN g % 4 = 2 THEN 'conv' || (g / 10) END, g % 10
FROM nt, generate_series(1, 4) g;
INSERT INTO spend_ledger (user_id, period_key, cost_class, aed, calls)
SELECT id::text, 'm:2026-' || lpad(m::text, 2, '0'), cls, 3.5, 40 FROM u, generate_series(1, 11) m, unnest(ARRAY['extraction','import','recall','pointers','transcription']) cls;
INSERT INTO ai_usage_month (user_id, period_key, period_start_ms, allowance_aed, messages_allowance, messages_used)
SELECT id, 'm:2025-' || lpad(m::text, 2, '0') || '-' || y, extract(epoch FROM make_date(2026, m, 1))::bigint * 1000 + y, 60, 10000, 4000 FROM u, generate_series(1, 12) m, generate_series(1, 3) y;
INSERT INTO ai_reservation (user_id, period_key, estimate_aed, status, expires_at)
SELECT id, 'm:2026-11', 0.2, (ARRAY['settled','settled','released','open','expired'])[1 + g % 5], now() + ((g % 3 - 1) || ' hours')::interval FROM u, generate_series(1, 100) g;
INSERT INTO transcription_events (user_id, period_key, model, audio_seconds, estimated, created_at)
SELECT user_id::text, 'm:2026-11', 'whisper', 60, false, now() - (k || ' days')::interval FROM nt;
INSERT INTO revenue_events (stripe_id, user_id, kind, amount_fils, currency, paid_at, period_key)
SELECT 'in_' || n || '_' || m, id::text, 'subscription', 29900, 'aed', now(), 'm:2026-' || lpad(m::text, 2, '0') FROM u, generate_series(1, 60) m;
INSERT INTO extraction_counters (user_id, period_key, count) SELECT id, 'm:' || m, 400 FROM u, generate_series(1, 60) m;
INSERT INTO daily_priorities (user_id, day, actions, refresh_count) SELECT id, current_date - g, '[]', 1 FROM u, generate_series(0, 90) g;
INSERT INTO push_budget (user_id, day, sent) SELECT id, current_date - g, 2 FROM u, generate_series(0, 90) g;
INSERT INTO email_log (user_id, event_key, sent_at) SELECT id, 'evt' || g, now() FROM u, generate_series(1, 60) g;
INSERT INTO sessions (token, user_id, expires_at) SELECT 'tok' || n || '_' || g, id, now() + interval '30 days' FROM u, generate_series(1, 60) g;
INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) SELECT id, 'https://push.example/' || n || '/' || g, 'k', 'a' FROM u, generate_series(1, 30) g;
INSERT INTO rep_glossary (user_id, wrong_term, right_term) SELECT id, 'wrong' || g, 'right' || g FROM u, generate_series(1, 30) g;
INSERT INTO note_move_audit (user_id, note_id, kind, from_client_id, to_client_id, counts, occurred_at)
SELECT user_id, id, 'move', client_id, client_id, '{}', now() FROM nt WHERE random() < 0.4;
INSERT INTO erasure_requests (user_id, requester_names, requested_at, window_ends_at, status) SELECT id, ARRAY['Khalid'], now(), now() + interval '14 days', 'pending' FROM u WHERE n % 10 = 0;
INSERT INTO erasure_audit (user_id, requester_names, categories) SELECT id, ARRAY['Khalid'], '{}' FROM u WHERE n % 10 = 0;

-- operator plane and public tables
INSERT INTO access_requests (full_name, work_email, company_name, role_title, status, source, created_at, linked_user_id)
SELECT 'Lead ' || g, 'lead' || g || '@example.test', 'Co', 'Broker', (ARRAY['pending','approved','invited','activated','rejected'])[1 + g % 5], 'hot_lead', now() - (g || ' hours')::interval,
  CASE WHEN g <= 40 THEN (SELECT id FROM u WHERE n = g) END FROM generate_series(1, 3000) g;
INSERT INTO hot_leads (person_id, campaign_id, name, email, status, became_hot_at, first_seen_at, access_request_id)
SELECT 'p' || g, 1 + g % 5, 'Lead ' || g, 'hl' || g || '@example.test', (ARRAY['new','contacted','invited','requested','signed_up','not_interested'])[1 + g % 6],
  now() - (g || ' hours')::interval, now(), CASE WHEN g % 3 = 0 THEN (SELECT id FROM access_requests ORDER BY id OFFSET (g % 3000) LIMIT 1) END
FROM generate_series(1, 4000) g;
INSERT INTO page_views (day, page, referrer_domain, device, visitor_hash, created_at)
SELECT current_date - (g % 120), (ARRAY['landing','request_access','sign_in','privacy','submitted'])[1 + g % 5], 'google.com', CASE WHEN g % 3 = 0 THEN 'desktop' ELSE 'phone' END, CASE WHEN g % 120 < 2 THEN md5(g::text) END, now() FROM generate_series(1, 20000) g;
INSERT INTO visit_days (day, views, uniques, landing_uniques, reached_request, submitted) SELECT current_date - g, 100, 50, 40, 10, 2 FROM generate_series(2, 3000) g;
INSERT INTO visit_excluded (day, visitor_hash) SELECT current_date - (g % 300), md5(g::text) FROM generate_series(1, 3000) g;
INSERT INTO game_events (day, event, industry, chat, caught, details, wrong, bucket)
SELECT current_date - (g % 90), 'game_view', 'Property', 1, 0, 1, false, '0-3' FROM generate_series(1, 5000) g;
INSERT INTO admin_audit (admin_email, action, target, detail, at) SELECT 'admin@example.test', 'view', 't', '{}', now() - (g || ' minutes')::interval FROM generate_series(1, 5000) g;
INSERT INTO ops_alerts (kind, user_id, dedupe_key, detail, created_at) SELECT 'spend', 'system', 'd' || g, '{}', now() - (g || ' minutes')::interval FROM generate_series(1, 3000) g;
INSERT INTO webhook_events (id, processed_at) SELECT 'evt_' || g, now() FROM generate_series(1, 5000) g;
INSERT INTO whatsapp_inbound (message_id, received_at) SELECT 'wamid' || g, now() - (g || ' minutes')::interval FROM generate_series(1, 5000) g;
UPDATE subscriptions SET free_access_since = now(), free_access_by = 'owner' WHERE stripe_customer_id IN ('cus_1', 'cus_2');
INSERT INTO trial_grants (email, granted_at) SELECT 'grant' || g || '@example.test', now() FROM generate_series(1, 3000) g;
INSERT INTO referrals (referred_email, referrer_id, created_at) SELECT 'ref' || g || '@example.test', (SELECT id FROM u WHERE n = 1 + g % 40), now() FROM generate_series(1, 3000) g;
INSERT INTO invoice_tax (invoice_id, user_id, issued_at, country, total_fils, tax_invoice, zero_rated, net_fils, vat_fils, rate)
SELECT 'in_t' || g, (SELECT id FROM u WHERE n = 1 + g % 40), now(), 'AE', 29900, true, false, 28476, 1424, 0.05 FROM generate_series(1, 3000) g;

SET session_replication_role = DEFAULT;
