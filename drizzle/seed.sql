-- Deterministic demo baseline for local dev + tests. Applied via `pnpm db:seed`
-- (and `pnpm db:reset`). Timestamps are unix seconds (unixepoch()), matching
-- Drizzle's integer timestamp mode. Every screen gets data: one event,
-- taxonomies, 3 forms WITH fields + a conditional rule, submissions across
-- EVERY status (+ answers), reviews, onboarding tasks backed by portal forms
-- (hotel + flight), scheduled + unscheduled sessions, editable email templates.
--
-- Passwords are REAL PBKDF2 hashes (WebCrypto format, 100k iters (Workers runtime cap), see
-- app/lib/auth.ts) for the password "password", so seeded accounts log in.

-- Children first (FK-safe).
DELETE FROM email_outbox;
DELETE FROM email_templates;
DELETE FROM airtable_links;
DELETE FROM api_tokens;
DELETE FROM embeds;
DELETE FROM file_comments;
DELETE FROM task_assignments;
DELETE FROM tasks;
DELETE FROM portal_forms;
DELETE FROM files;
DELETE FROM evaluation_answers;
DELETE FROM evaluations;
DELETE FROM round_questions;
DELETE FROM round_evaluators;
DELETE FROM evaluation_rounds;
DELETE FROM evaluation_plans;
DELETE FROM submission_revisions;
DELETE FROM reviews;
DELETE FROM reviewer_tracks;
DELETE FROM submission_answers;
DELETE FROM submission_tags;
DELETE FROM submission_tracks;
DELETE FROM participants;
DELETE FROM submissions;
DELETE FROM form_fields;
DELETE FROM fields;
DELETE FROM forms;
DELETE FROM contacts;
DELETE FROM portals;
DELETE FROM rooms;
DELETE FROM languages;
DELETE FROM levels;
DELETE FROM formats;
DELETE FROM tags;
DELETE FROM tracks;
DELETE FROM password_resets;
DELETE FROM auth_sessions;
DELETE FROM events;
DELETE FROM users;

INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES
 ('u_admin',    'admin@example.com',    'pbkdf2$100000$aSqRq0XCE+U62GUmG1OUqg==$7007E8kKOtwNCfhBs3QTdUh/aS1iJwcjCfU//25YYjU=', 'Demo Admin',    'admin',    unixepoch()),
 ('u_speaker',  'speaker@example.com',  'pbkdf2$100000$aSqRq0XCE+U62GUmG1OUqg==$7007E8kKOtwNCfhBs3QTdUh/aS1iJwcjCfU//25YYjU=', 'Sam Speaker',   'speaker',  unixepoch()),
 ('u_reviewer', 'reviewer@example.com', 'pbkdf2$100000$aSqRq0XCE+U62GUmG1OUqg==$7007E8kKOtwNCfhBs3QTdUh/aS1iJwcjCfU//25YYjU=', 'Riley Reviewer','reviewer', unixepoch());

INSERT INTO events (id, name, slug, type, timezone, starts_at, ends_at, created_at) VALUES
 ('e_demo', 'AI.Engineer Sandbox Event', 'ai-engineer-sandbox', 'Conference', 'America/Los_Angeles',
  unixepoch('2026-10-12'), unixepoch('2026-10-14'), unixepoch());

INSERT INTO tracks (id, event_id, name, color, created_at) VALUES
 ('t_innovation', 'e_demo', 'Innovation', '#6366f1', unixepoch()),
 ('t_practice',   'e_demo', 'Practice',   '#10b981', unixepoch());

INSERT INTO tags (id, event_id, name, color, created_at) VALUES
 ('tag_agents', 'e_demo', 'Agents', '#f59e0b', unixepoch()),
 ('tag_rag',    'e_demo', 'RAG',    '#3b82f6', unixepoch());

INSERT INTO formats (id, event_id, name, default_duration_mins, position, created_at) VALUES
 ('fmt_keynote',  'e_demo', 'Featured Keynote', 45, 0, unixepoch()),
 ('fmt_breakout', 'e_demo', 'Breakout',         30, 1, unixepoch());

INSERT INTO levels (id, event_id, name, position, created_at) VALUES
 ('lvl_intro', 'e_demo', 'Introductory', 0, unixepoch()),
 ('lvl_inter', 'e_demo', 'Intermediate', 1, unixepoch());

INSERT INTO rooms (id, event_id, name, capacity, display_order, created_at) VALUES
 ('room_a', 'e_demo', 'Room A', 300, 0, unixepoch()),
 ('room_b', 'e_demo', 'Room B', 120, 1, unixepoch());

INSERT INTO languages (id, event_id, name, position, created_at) VALUES
 ('lang_en', 'e_demo', 'English', 0, unixepoch());

INSERT INTO portals (id, event_id, public_id, name, created_at) VALUES
 ('portal_demo', 'e_demo', 'portal-demo-uuid', 'Speaker Portal', unixepoch());

-- Make the demo admin operate on the demo event out of the box.
UPDATE users SET active_event_id = 'e_demo' WHERE id = 'u_admin';

INSERT INTO forms (id, event_id, public_id, type, status, internal_name, external_title, close_at, created_at, updated_at) VALUES
 ('form_sessions', 'e_demo', 'form-sessions-uuid', 'session',  'open',   'Session CFP',  'Call for Sessions',  unixepoch('2026-09-15'), unixepoch(), unixepoch()),
 ('form_abstracts','e_demo', 'form-abstracts-uuid','abstract', 'open',   'Abstract CFP', 'Call for Abstracts', unixepoch('2026-09-15'), unixepoch(), unixepoch()),
 ('form_workshops','e_demo', 'form-workshops-uuid','session',  'closed', 'Workshop CFP', 'Call for Workshops', unixepoch('2026-08-01'), unixepoch(), unixepoch());

-- Custom field library + placement on the Session form, incl. a conditional rule.
INSERT INTO fields (id, event_id, name, type, options, scope, created_at) VALUES
 ('fld_experience', 'e_demo', 'Prior speaking experience', 'dropdown', '["First time","Experienced"]', 'event', unixepoch()),
 ('fld_notes',      'e_demo', 'Anything else to share?',   'textarea', NULL,                            'event', unixepoch());

INSERT INTO form_fields (id, form_id, field_id, section, position, required, question_rule, created_at) VALUES
 ('ff_experience', 'form_sessions', 'fld_experience', 'session', 0, 1, NULL, unixepoch()),
 -- show the notes field only when experience = "Experienced"
 ('ff_notes',      'form_sessions', 'fld_notes',      'session', 1, 0, '{"fieldId":"fld_experience","operator":"equals","value":"Experienced"}', unixepoch());

INSERT INTO contacts (id, event_id, user_id, email, first_name, last_name, bio, created_at) VALUES
 ('c_sam',  'e_demo', 'u_speaker', 'speaker@example.com', 'Sam',  'Speaker', 'Builder of agents.',        unixepoch()),
 ('c_alex', 'e_demo', NULL,        'alex@example.com',    'Alex', 'Co',      'Co-speaker and RAG nerd.',  unixepoch());

-- One submission per status (drives the review status tabs + dashboard counts).
INSERT INTO submissions (id, event_id, form_id, type, title, description, status, submitter_id, format_id, level_id, starts_at, ends_at, room_id, created_at, updated_at) VALUES
 ('s_draft',    'e_demo', 'form_sessions', 'session', 'Draft: agent memory',            'WIP draft.',                         'draft',         'u_speaker', 'fmt_breakout', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_pending',  'e_demo', 'form_sessions', 'session', 'Scaling LLM agents in production','A deep dive into agent swarms.',     'pending',       'u_speaker', 'fmt_breakout', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_acceptq',  'e_demo', 'form_sessions', 'session', 'Eval-driven agent design',        'Staged for acceptance.',             'accept_queue',  'u_speaker', 'fmt_breakout', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_accepted', 'e_demo', 'form_sessions', 'session', 'From RAG to riches',              'A keynote on retrieval systems.',    'accepted',      'u_speaker', 'fmt_keynote',  'lvl_intro', unixepoch('2026-10-12 17:00'), unixepoch('2026-10-12 17:45'), 'room_a', unixepoch(), unixepoch()),
 ('s_accepted2','e_demo', 'form_sessions', 'session', 'Agents in the enterprise',        'Accepted but not yet scheduled.',    'accepted',      'u_speaker', 'fmt_breakout', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_declineq', 'e_demo', 'form_sessions', 'session', 'Staged for decline',              'In the decline queue.',              'decline_queue', 'u_speaker', 'fmt_breakout', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_declined', 'e_demo', 'form_sessions', 'session', 'Not this year',                   'Declined submission.',               'declined',      'u_speaker', 'fmt_breakout', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_withdrawn','e_demo', 'form_sessions', 'session', 'Withdrawn talk',                  'Speaker withdrew.',                  'withdrawn',     'u_speaker', 'fmt_breakout', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch());

UPDATE submissions
   SET withdrawn_at = unixepoch(), withdrawn_by_id = 'u_speaker', withdrawn_reason = 'Schedule conflict.'
 WHERE id = 's_withdrawn';

INSERT INTO submission_tracks (submission_id, track_id) VALUES
 ('s_pending',   't_innovation'),
 ('s_acceptq',   't_innovation'),
 ('s_accepted',  't_practice'),
 ('s_accepted2', 't_innovation'),
 ('s_declined',  't_practice');

INSERT INTO submission_tags (submission_id, tag_id) VALUES
 ('s_pending',  'tag_agents'),
 ('s_accepted', 'tag_rag');

INSERT INTO submission_answers (id, submission_id, field_id, value) VALUES
 ('sa_1', 's_accepted', 'fld_experience', 'Experienced'),
 ('sa_2', 's_accepted', 'fld_notes',      'Happy to run a workshop too.'),
 ('sa_3', 's_pending',  'fld_experience', 'First time');

INSERT INTO participants (id, submission_id, contact_id, role, is_primary, position, created_at) VALUES
 ('p_1', 's_pending',   'c_sam',  'speaker', 1, 0, unixepoch()),
 ('p_2', 's_accepted',  'c_sam',  'speaker', 1, 0, unixepoch()),
 ('p_3', 's_accepted',  'c_alex', 'speaker', 0, 1, unixepoch()),
 ('p_4', 's_accepted2', 'c_sam',  'speaker', 1, 0, unixepoch());

INSERT INTO reviewer_tracks (user_id, track_id) VALUES
 ('u_reviewer', 't_innovation'),
 ('u_reviewer', 't_practice');

INSERT INTO reviews (id, submission_id, reviewer_id, decision, comment, created_at, updated_at) VALUES
 ('r_1', 's_acceptq', 'u_reviewer', 'approve', 'Strong fit for Innovation.', unixepoch(), unixepoch()),
 ('r_2', 's_declineq','u_reviewer', 'deny',    'Out of scope this year.',     unixepoch(), unixepoch());

-- The must-have onboarding tasks ARE portal forms the speaker fills in.
INSERT INTO portal_forms (id, event_id, name, title, target_type, schema, created_at) VALUES
 ('pf_hotel',  'e_demo', 'Hotel Stay',           'Book your hotel',       'contact', '[{"name":"Hotel name","type":"text","required":true},{"name":"Check-in date","type":"date","required":true}]', unixepoch()),
 ('pf_flight', 'e_demo', 'Flight Reimbursement', 'Submit your flight',    'contact', '[{"name":"Airline","type":"text","required":true},{"name":"Amount (USD)","type":"number","required":true}]',   unixepoch());

INSERT INTO tasks (id, event_id, name, type, description, portal_form_id, is_onboarding_default, required, created_at) VALUES
 ('task_hotel',  'e_demo', 'Hotel & Travel Reservations', 'contact',    'Book your hotel stay.',                 'pf_hotel',  1, 1, unixepoch()),
 ('task_flight', 'e_demo', 'Flight Reimbursement',        'contact',    'Submit your flight for reimbursement.', 'pf_flight', 1, 1, unixepoch()),
 ('task_slides', 'e_demo', 'Presentation Upload',         'submission', 'Upload your slides.',                   NULL,        1, 0, unixepoch());

-- Onboarding tasks auto-assigned to the accepted speaker; incomplete → the
-- outstanding-tasks dashboard has something to show.
INSERT INTO task_assignments (id, task_id, contact_id, submission_id, status, due_at, created_at) VALUES
 ('ta_1', 'task_hotel',  'c_sam', NULL,         'incomplete', unixepoch('2026-10-01'), unixepoch()),
 ('ta_2', 'task_flight', 'c_sam', NULL,         'incomplete', unixepoch('2026-10-01'), unixepoch()),
 ('ta_3', 'task_slides', 'c_sam', 's_accepted', 'complete',   unixepoch('2026-10-05'), unixepoch());

-- Accepted sessions ship content-approved so the public widgets render out of
-- the box; new submissions default to 'draft'.
UPDATE submissions SET content_status = 'approved' WHERE status = 'accepted';

-- The demo agenda is published (gates the public agenda/itinerary widgets).
UPDATE events SET agenda_published_at = unixepoch() WHERE id = 'e_demo';

-- One confirmed contact so the roster status filter has mixed data.
UPDATE contacts SET status = 'confirmed' WHERE id = 'c_sam';

-- One evaluation plan, two rounds with distinct scorecards, reviewer pooled on
-- round 1 only, pending queue rows = the assignment set.
INSERT INTO evaluation_plans (id, event_id, name, instructions, status, created_at) VALUES
 ('ep_demo', 'e_demo', 'Initial Review', 'Score each submission on originality and relevance.', 'open', unixepoch());

INSERT INTO evaluation_rounds (id, plan_id, name, position, opens_at, closes_at, anonymized, show_other_scores, created_at) VALUES
 ('er_1', 'ep_demo', 'Initial Review', 0, unixepoch('2026-08-01'), unixepoch('2026-10-15'), 1, 0, unixepoch()),
 ('er_2', 'ep_demo', 'Final Review',   1, unixepoch('2026-10-16'), unixepoch('2026-11-30'), 0, 0, unixepoch());

INSERT INTO round_questions (id, round_id, label, type, config, weight, required, position) VALUES
 ('rq_orig',  'er_1', 'Originality',    'rating',   '{"min":1,"max":5}',                            2, 1, 0),
 ('rq_rel',   'er_1', 'Relevance',      'rating',   '{"min":1,"max":5}',                            1, 1, 1),
 ('rq_rec',   'er_1', 'Recommendation', 'dropdown', '{"options":["Accept","Maybe","Reject"]}',      1, 1, 2),
 ('rq_com',   'er_1', 'Comments',       'text',     NULL,                                           1, 0, 3),
 ('rq_final', 'er_2', 'Final Score',    'rating',   '{"min":1,"max":10}',                           1, 1, 0),
 ('rq_com2',  'er_2', 'Comments',       'text',     NULL,                                           1, 0, 1);

INSERT INTO round_evaluators (round_id, user_id) VALUES
 ('er_1', 'u_reviewer');

INSERT INTO evaluations (id, round_id, submission_id, evaluator_id, status, created_at, updated_at) VALUES
 ('ev_1', 'er_1', 's_acceptq',  'u_reviewer', 'pending', unixepoch(), unixepoch()),
 ('ev_2', 'er_1', 's_declineq', 'u_reviewer', 'pending', unixepoch(), unixepoch());

-- One configured embed so the embeds admin screen has data.
INSERT INTO embeds (id, event_id, public_id, name, type, enabled, config, created_at) VALUES
 ('emb_demo', 'e_demo', 'embed-demo-uuid', 'Website sessions list', 'sessions', 1, '{}', unixepoch());

-- Compat-API token: raw value "kms-demo-api-token" (documented in docs/JUDGING.md).
INSERT INTO api_tokens (id, name, token_hash, created_at) VALUES
 ('apitok_demo', 'Demo token', '4d8bfefbee32ccc1ca5ac38e161464666eaba9ef881e1969de204aeab0470b43', unixepoch());

INSERT INTO email_templates (id, event_id, key, name, subject, body_html, category, trigger, created_at, updated_at) VALUES
 ('et_confirm', 'e_demo', 'submission_confirmation', 'Submission Confirmation',           'We received your submission', '<p>Thanks for submitting!</p>',        'lifecycle', 'auto',   unixepoch(), unixepoch()),
 ('et_accept',  'e_demo', 'accept',                  'Accept Sessions',                   'Your session was accepted',   '<p>Congratulations, you are in!</p>',  'lifecycle', 'manual', unixepoch(), unixepoch()),
 ('et_decline', 'e_demo', 'decline',                 'Decline Sessions',                  'Update on your submission',   '<p>Thank you for submitting.</p>',     'lifecycle', 'manual', unixepoch(), unixepoch()),
 ('et_rem5',    'e_demo', 'reminder_5day',           'Session Form - Five Days Reminder', 'Five days left to submit',    '<p>The form closes in five days.</p>', 'lifecycle', 'auto',   unixepoch(), unixepoch()),
 ('et_rem1',    'e_demo', 'reminder_1day',           'Session Form - One Day Reminder',   'One day left to submit',      '<p>The form closes tomorrow.</p>',     'lifecycle', 'auto',   unixepoch(), unixepoch());
