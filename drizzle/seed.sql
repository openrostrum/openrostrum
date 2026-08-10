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
DELETE FROM organization_members;
DELETE FROM organizations;
DELETE FROM users;

INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES
 ('u_admin',    'admin@example.com',    'pbkdf2$100000$aSqRq0XCE+U62GUmG1OUqg==$7007E8kKOtwNCfhBs3QTdUh/aS1iJwcjCfU//25YYjU=', 'Demo Admin',    'admin',    unixepoch()),
 ('u_speaker',  'speaker@example.com',  'pbkdf2$100000$aSqRq0XCE+U62GUmG1OUqg==$7007E8kKOtwNCfhBs3QTdUh/aS1iJwcjCfU//25YYjU=', 'Sam Speaker',   'speaker',  unixepoch()),
 ('u_reviewer', 'reviewer@example.com', 'pbkdf2$100000$aSqRq0XCE+U62GUmG1OUqg==$7007E8kKOtwNCfhBs3QTdUh/aS1iJwcjCfU//25YYjU=', 'Riley Reviewer','reviewer', unixepoch());

-- The Demo organization: the tenant the sandbox event (and the shared judge
-- seat) lives in. Self-serve sign-ups mint their own orgs and never see it.
INSERT INTO organizations (id, name, created_at) VALUES
 ('org_demo', 'Demo', unixepoch());

INSERT INTO organization_members (id, organization_id, user_id, created_at) VALUES
 ('om_admin', 'org_demo', 'u_admin', unixepoch());

INSERT INTO events (id, organization_id, name, slug, type, timezone, starts_at, ends_at, created_at) VALUES
 ('e_demo', 'org_demo', 'AI.Engineer Sandbox Event', 'ai-engineer-sandbox', 'Conference', 'America/Los_Angeles',
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
-- Scope XOR: event fields set event_id (organization_id NULL); org-wide fields
-- would set organization_id with event_id NULL.
INSERT INTO fields (id, event_id, name, type, options, created_at) VALUES
 ('fld_experience', 'e_demo', 'Prior speaking experience', 'dropdown', '["First time","Experienced"]', unixepoch()),
 ('fld_notes',      'e_demo', 'Anything else to share?',   'textarea', NULL,                            unixepoch());

INSERT INTO form_fields (id, form_id, field_id, section, position, required, question_rule, created_at) VALUES
 ('ff_experience', 'form_sessions', 'fld_experience', 'session', 0, 1, NULL, unixepoch()),
 -- show the notes field only when experience = "Experienced"
 ('ff_notes',      'form_sessions', 'fld_notes',      'session', 1, 0, '{"trigger":{"kind":"field","fieldId":"fld_experience"},"operator":"equals","value":"Experienced"}', unixepoch());

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

-- ---------------------------------------------------------------------------
-- Agenda walkthrough baseline (scenario 06 header / walk-06 gap H1).
-- Adds the scenario-named rooms/formats/tracks and a real 3-day program:
-- scheduled sessions across the event days (Oct 12-14, all inside the
-- 08:00-18:00 event-TZ agenda window; PDT = UTC-7, so SQL literals below are
-- UTC = wall clock + 7h), the five named UNSCHEDULED accepted fixtures, and
-- the two non-schedulable negative fixtures. Existing rows above are
-- untouched (ids AND values) — this section only ADDS rows.
-- Deliberate free slots: no room/day is close to full, and Main Hall +
-- Room 305 are kept FREE on Oct 12 between 9:00 AM and 2:00 PM PDT
-- (16:00-21:00 UTC) — the scenario's drag targets.
-- ---------------------------------------------------------------------------

INSERT INTO tracks (id, event_id, name, color, created_at) VALUES
 ('t_devex',   'e_demo', 'Developer Experience', '#f59e0b', unixepoch()),
 ('t_aiinfra', 'e_demo', 'AI Infrastructure',    '#0ea5e9', unixepoch());

-- Scenario format set: Featured Keynote 45 (seeded above) · Talk 30 · Panel 60
-- · Workshop 90. The legacy 'Breakout' (30) stays — rows are never removed.
INSERT INTO formats (id, event_id, name, default_duration_mins, position, created_at) VALUES
 ('fmt_talk',     'e_demo', 'Talk',     30, 2, unixepoch()),
 ('fmt_panel',    'e_demo', 'Panel',    60, 3, unixepoch()),
 ('fmt_workshop', 'e_demo', 'Workshop', 90, 4, unixepoch());

INSERT INTO rooms (id, event_id, name, capacity, display_order, created_at) VALUES
 ('room_main', 'e_demo', 'Main Hall',       500, 2, unixepoch()),
 ('room_wsb',  'e_demo', 'Workshop Room B',  80, 3, unixepoch()),
 ('room_305',  'e_demo', 'Room 305',         60, 4, unixepoch());

-- Speakers for the named fixtures. Marco Silva speaks in TWO sessions — the
-- speaker double-book fixture (AG-S4). No portal logins (user_id NULL).
INSERT INTO contacts (id, event_id, user_id, email, first_name, last_name, bio, created_at) VALUES
 ('c_noor',  'e_demo', NULL, 'noor.haddad@example.com',  'Noor',  'Haddad', 'Closing keynotes on the post-SaaS stack.', unixepoch()),
 ('c_marco', 'e_demo', NULL, 'marco.silva@example.com',  'Marco', 'Silva',  'Agent swarms and D1 performance.',         unixepoch()),
 ('c_dana',  'e_demo', NULL, 'dana.fields@example.com',  'Dana',  'Fields', 'Panel moderator and CFP skeptic.',         unixepoch()),
 ('c_lena',  'e_demo', NULL, 'lena.ortiz@example.com',   'Lena',  'Ortiz',  'Email deliverability practitioner.',       unixepoch());

-- SCHEDULED accepted sessions (starts_at/ends_at/room set; durations match the
-- session's format default). Oct 13 is the densest day.
INSERT INTO submissions (id, event_id, form_id, type, title, description, status, submitter_id, format_id, level_id, starts_at, ends_at, room_id, created_at, updated_at) VALUES
 -- Mon Oct 12 (Main Hall + Room 305 free 9:00 AM-2:00 PM PDT)
 ('s_open_keynote',     'e_demo', 'form_sessions', 'session', 'Opening Keynote: The State of AI Engineering', 'Where the field actually is.',            'accepted', 'u_speaker', 'fmt_keynote',  'lvl_intro', unixepoch('2026-10-12 15:00'), unixepoch('2026-10-12 15:45'), 'room_main', unixepoch(), unixepoch()),
 ('s_open_models',      'e_demo', 'form_sessions', 'session', 'Panel: Open Models in Production',             'Four teams, four stacks.',                'accepted', 'u_speaker', 'fmt_panel',    'lvl_inter', unixepoch('2026-10-12 21:30'), unixepoch('2026-10-12 22:30'), 'room_main', unixepoch(), unixepoch()),
 ('s_prompt_injection', 'e_demo', 'form_sessions', 'session', 'Prompt Injection Deep Dive',                   'Attacks and mitigations in the wild.',    'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-12 16:30'), unixepoch('2026-10-12 17:00'), 'room_wsb',  unixepoch(), unixepoch()),
 ('s_finetune_ws',      'e_demo', 'form_sessions', 'session', 'Hands-on: Fine-tuning Small Models',           'Bring a laptop, leave with a model.',     'accepted', 'u_speaker', 'fmt_workshop', 'lvl_inter', unixepoch('2026-10-12 18:00'), unixepoch('2026-10-12 19:30'), 'room_wsb',  unixepoch(), unixepoch()),
 ('s_retrieval',        'e_demo', 'form_sessions', 'session', 'Retrieval Beyond Vectors',                     'Hybrid search that actually ships.',      'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-12 20:00'), unixepoch('2026-10-12 20:30'), 'room_a',    unixepoch(), unixepoch()),
 ('s_budget_llms',      'e_demo', 'form_sessions', 'session', 'Serving LLMs on a Budget',                     'Tokens per dollar, maximized.',           'accepted', 'u_speaker', 'fmt_talk',     'lvl_intro', unixepoch('2026-10-12 17:00'), unixepoch('2026-10-12 17:30'), 'room_b',    unixepoch(), unixepoch()),
 ('s_evals_ws',         'e_demo', 'form_sessions', 'session', 'Hands-on: Evals from Scratch',                 'Build an eval harness in 90 minutes.',    'accepted', 'u_speaker', 'fmt_workshop', 'lvl_inter', unixepoch('2026-10-12 21:30'), unixepoch('2026-10-12 23:00'), 'room_305',  unixepoch(), unixepoch()),
 -- Tue Oct 13 (densest day)
 ('s_postcloud',        'e_demo', 'form_sessions', 'session', 'Keynote: The Post-Cloud Developer',            'What comes after the console.',           'accepted', 'u_speaker', 'fmt_keynote',  'lvl_intro', unixepoch('2026-10-13 16:00'), unixepoch('2026-10-13 16:45'), 'room_main', unixepoch(), unixepoch()),
 ('s_inference_econ',   'e_demo', 'form_sessions', 'session', 'Panel: The Economics of Inference',            'Margins, moats, and GPUs.',               'accepted', 'u_speaker', 'fmt_panel',    'lvl_inter', unixepoch('2026-10-13 18:00'), unixepoch('2026-10-13 19:00'), 'room_main', unixepoch(), unixepoch()),
 ('s_agents_ship',      'e_demo', 'form_sessions', 'session', 'Agents that Ship: Case Studies',               'Three production post-mortems.',          'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-13 21:00'), unixepoch('2026-10-13 21:30'), 'room_main', unixepoch(), unixepoch()),
 ('s_llm_obs_ws',       'e_demo', 'form_sessions', 'session', 'Hands-on: Observability for LLM Apps',         'Traces, evals, and dashboards.',          'accepted', 'u_speaker', 'fmt_workshop', 'lvl_inter', unixepoch('2026-10-13 16:30'), unixepoch('2026-10-13 18:00'), 'room_wsb',  unixepoch(), unixepoch()),
 ('s_structured_out',   'e_demo', 'form_sessions', 'session', 'Structured Output at Scale',                   'Schemas beat regexes.',                   'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-13 20:00'), unixepoch('2026-10-13 20:30'), 'room_wsb',  unixepoch(), unixepoch()),
 ('s_localfirst',       'e_demo', 'form_sessions', 'session', 'Local-first AI Apps',                          'Offline inference patterns.',             'accepted', 'u_speaker', 'fmt_talk',     'lvl_intro', unixepoch('2026-10-13 17:00'), unixepoch('2026-10-13 17:30'), 'room_305',  unixepoch(), unixepoch()),
 ('s_build_buy',        'e_demo', 'form_sessions', 'session', 'Panel: Build vs Buy for AI Platforms',         'The eternal question, 2026 edition.',     'accepted', 'u_speaker', 'fmt_panel',    'lvl_intro', unixepoch('2026-10-13 22:00'), unixepoch('2026-10-13 23:00'), 'room_305',  unixepoch(), unixepoch()),
 ('s_llm_caching',      'e_demo', 'form_sessions', 'session', 'Caching Strategies for LLM APIs',              'Semantic caches without the foot-guns.',  'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-13 18:30'), unixepoch('2026-10-13 19:00'), 'room_a',    unixepoch(), unixepoch()),
 ('s_multimodal',       'e_demo', 'form_sessions', 'session', 'Multimodal Pipelines in Practice',             'Vision + text, end to end.',              'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-13 23:00'), unixepoch('2026-10-13 23:30'), 'room_b',    unixepoch(), unixepoch()),
 -- Wed Oct 14
 ('s_cfp_design',       'e_demo', 'form_sessions', 'session', 'Designing Speaker-first CFPs',                 'Forms speakers do not hate.',             'accepted', 'u_speaker', 'fmt_talk',     'lvl_intro', unixepoch('2026-10-14 16:00'), unixepoch('2026-10-14 16:30'), 'room_main', unixepoch(), unixepoch()),
 ('s_closing_panel',    'e_demo', 'form_sessions', 'session', 'Closing Panel: Where Do We Go From Here?',     'The wrap-up.',                            'accepted', 'u_speaker', 'fmt_panel',    'lvl_intro', unixepoch('2026-10-14 23:00'), unixepoch('2026-10-15 00:00'), 'room_main', unixepoch(), unixepoch()),
 ('s_confsite_ws',      'e_demo', 'form_sessions', 'session', 'Hands-on: Shipping a Conference Site in a Day','From repo to live program page.',         'accepted', 'u_speaker', 'fmt_workshop', 'lvl_inter', unixepoch('2026-10-14 17:00'), unixepoch('2026-10-14 18:30'), 'room_wsb',  unixepoch(), unixepoch()),
 ('s_post_transformer', 'e_demo', 'form_sessions', 'session', 'The Post-Transformer Landscape',               'Architectures on the horizon.',           'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-14 18:00'), unixepoch('2026-10-14 18:30'), 'room_305',  unixepoch(), unixepoch()),
 ('s_d1_migrations',    'e_demo', 'form_sessions', 'session', 'Zero-downtime Migrations on D1',               'Schema evolution without the outage.',    'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-14 21:00'), unixepoch('2026-10-14 21:30'), 'room_a',    unixepoch(), unixepoch());

-- UNSCHEDULED accepted sessions — the five scenario-named drag fixtures
-- (no starts_at/ends_at/room; they live in the Unscheduled panel).
INSERT INTO submissions (id, event_id, form_id, type, title, description, status, submitter_id, format_id, level_id, starts_at, ends_at, room_id, created_at, updated_at) VALUES
 ('s_closing_keynote', 'e_demo', 'form_sessions', 'session', 'Closing Keynote: The Post-SaaS Stack',      'What replaces the subscription wall.',   'accepted', 'u_speaker', 'fmt_keynote',  'lvl_intro', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_live_demo',       'e_demo', 'form_sessions', 'session', 'Live Demo: Agent Swarms in Production',     'No slides, just terminals.',             'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_office_hours',    'e_demo', 'form_sessions', 'session', 'Office Hours: D1 Performance Clinic',       'Bring your slow queries.',               'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_panel_cfp',       'e_demo', 'form_sessions', 'session', 'Panel: Is the CFP Dead?',                   'Curation vs open calls.',                'accepted', 'u_speaker', 'fmt_panel',    'lvl_intro', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_workshop_email',  'e_demo', 'form_sessions', 'session', 'Workshop: Own Your Email Deliverability',   'SPF, DKIM, DMARC, hands-on.',            'accepted', 'u_speaker', 'fmt_workshop', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch());

-- Non-schedulable negative fixtures (AG-S1.4 / AG-S5.3): neither may appear in
-- the Unscheduled panel while schedulable statuses = ['accepted'].
INSERT INTO submissions (id, event_id, form_id, type, title, description, status, submitter_id, format_id, level_id, starts_at, ends_at, room_id, created_at, updated_at) VALUES
 ('s_soc2',        'e_demo', 'form_sessions', 'session', 'SOC 2 for Startups: A War Story', 'Compliance on a shoestring.',        'pending',      'u_speaker', 'fmt_talk', 'lvl_intro', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_gpu_pricing', 'e_demo', 'form_sessions', 'session', 'GPU Pricing Deep Dive',           'Spot markets and reserved fleets.',  'accept_queue', 'u_speaker', 'fmt_talk', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch());

-- Track pills/colors on the agenda blocks. The three Developer Experience rows
-- feed AG-S4's negative probe (same track + time is NOT a conflict).
INSERT INTO submission_tracks (submission_id, track_id) VALUES
 ('s_live_demo',        't_devex'),
 ('s_panel_cfp',        't_devex'),
 ('s_workshop_email',   't_devex'),
 ('s_cfp_design',       't_devex'),
 ('s_open_keynote',     't_aiinfra'),
 ('s_prompt_injection', 't_aiinfra'),
 ('s_inference_econ',   't_aiinfra'),
 ('s_gpu_pricing',      't_aiinfra'),
 ('s_finetune_ws',      't_practice'),
 ('s_agents_ship',      't_practice'),
 ('s_retrieval',        't_innovation'),
 ('s_localfirst',       't_innovation');

-- Marco Silva on BOTH s_live_demo and s_office_hours = the cross-room speaker
-- double-book fixture; the panel/workshop deliberately share no speakers.
INSERT INTO participants (id, submission_id, contact_id, role, is_primary, position, created_at) VALUES
 ('p_noor_ck',    's_closing_keynote', 'c_noor',  'speaker', 1, 0, unixepoch()),
 ('p_marco_demo', 's_live_demo',       'c_marco', 'speaker', 1, 0, unixepoch()),
 ('p_marco_oh',   's_office_hours',    'c_marco', 'speaker', 1, 0, unixepoch()),
 ('p_dana_panel', 's_panel_cfp',       'c_dana',  'speaker', 1, 0, unixepoch()),
 ('p_lena_ws',    's_workshop_email',  'c_lena',  'speaker', 1, 0, unixepoch());

-- Agenda-Settings baseline = [Accepted], written explicitly (walk-06 H2: the
-- schema's $defaultFn covers Drizzle inserts, not this raw-SQL seed).
UPDATE events SET schedulable_statuses = '["accepted"]' WHERE id = 'e_demo';

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
-- Org-scoped; event_id NULL = valid for all the Demo org's events.
INSERT INTO api_tokens (id, organization_id, name, token_hash, created_at) VALUES
 ('apitok_demo', 'org_demo', 'Demo token', '4d8bfefbee32ccc1ca5ac38e161464666eaba9ef881e1969de204aeab0470b43', unixepoch());

INSERT INTO email_templates (id, event_id, key, name, subject, body_html, category, trigger, created_at, updated_at) VALUES
 ('et_confirm', 'e_demo', 'submission_confirmation', 'Submission Confirmation',           'We received your submission', '<p>Thanks for submitting!</p>',        'lifecycle', 'auto',   unixepoch(), unixepoch()),
 ('et_accept',  'e_demo', 'accept',                  'Accept Sessions',                   'Your session was accepted',   '<p>Congratulations, you are in!</p>',  'lifecycle', 'manual', unixepoch(), unixepoch()),
 ('et_decline', 'e_demo', 'decline',                 'Decline Sessions',                  'Update on your submission',   '<p>Thank you for submitting.</p>',     'lifecycle', 'manual', unixepoch(), unixepoch()),
 ('et_rem5',    'e_demo', 'reminder_5day',           'Session Form - Five Days Reminder', 'Five days left to submit',    '<p>The form closes in five days.</p>', 'lifecycle', 'auto',   unixepoch(), unixepoch()),
 ('et_rem1',    'e_demo', 'reminder_1day',           'Session Form - One Day Reminder',   'One day left to submit',      '<p>The form closes tomorrow.</p>',     'lifecycle', 'auto',   unixepoch(), unixepoch());
