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
 ('u_admin',    'admin@example.com',    'pbkdf2$100000$aSqRq0XCE+U62GUmG1OUqg==$7007E8kKOtwNCfhBs3QTdUh/aS1iJwcjCfU//25YYjU=', 'Chris Okada',    'admin',    unixepoch()),
 ('u_speaker',  'speaker@example.com',  'pbkdf2$100000$aSqRq0XCE+U62GUmG1OUqg==$7007E8kKOtwNCfhBs3QTdUh/aS1iJwcjCfU//25YYjU=', 'Samira Cole',    'speaker',  unixepoch()),
 ('u_reviewer', 'reviewer@example.com', 'pbkdf2$100000$aSqRq0XCE+U62GUmG1OUqg==$7007E8kKOtwNCfhBs3QTdUh/aS1iJwcjCfU//25YYjU=', 'Riley Okonkwo',  'reviewer', unixepoch());

-- The Northbound organization: the tenant the demo summit (and the shared
-- judge seat) lives in. Self-serve sign-ups mint their own orgs and never see it.
INSERT INTO organizations (id, name, created_at) VALUES
 ('org_demo', 'Northbound Collective', unixepoch());

INSERT INTO organization_members (id, organization_id, user_id, created_at) VALUES
 ('om_admin', 'org_demo', 'u_admin', unixepoch());

INSERT INTO events (id, organization_id, name, slug, type, timezone, location, starts_at, ends_at, created_at) VALUES
 ('e_demo', 'org_demo', 'Northbound AI Summit 2026', 'northbound-ai-summit-2026', 'Conference', 'America/Los_Angeles',
  'Yerba Buena Center for the Arts, San Francisco, California',
  unixepoch('2026-10-12 15:00:00'), unixepoch('2026-10-15 01:00:00'), unixepoch());

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

INSERT INTO contacts (id, event_id, user_id, email, first_name, last_name, job_title, company_name, bio, created_at) VALUES
 ('c_sam',  'e_demo', 'u_speaker', 'speaker@example.com', 'Samira', 'Cole',   'Staff Engineer',     'Latticework', 'Samira builds retrieval and long-term memory for production assistants at Latticework. She previously spent six years on developer-tools infrastructure.', unixepoch()),
 ('c_alex', 'e_demo', NULL,        'alex@example.com',    'Alex',   'Moreau', 'Developer Advocate', 'Harborline',  'Alex maintains Harborline''s open retrieval toolkit and teaches teams how to measure search quality. They have run retrieval workshops at a dozen developer conferences.', unixepoch());

-- One submission per status (drives the review status tabs + dashboard counts).
INSERT INTO submissions (id, event_id, form_id, type, title, description, status, submitter_id, format_id, level_id, starts_at, ends_at, room_id, created_at, updated_at) VALUES
 ('s_draft',    'e_demo', 'form_sessions', 'session', 'Three layers of agent memory',   'Agents forget everything between runs unless you build memory on purpose. This talk covers the scratchpad, episodic, and long-term profile layers we use at Latticework, and when each one earns its storage cost. It is written for engineers who have an assistant in production and need it to remember more than the last prompt.', 'draft',         'u_speaker', 'fmt_breakout', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_pending',  'e_demo', 'form_sessions', 'session', 'Scaling LLM agents in production','Last year we went from one internal assistant to thousands of agent runs a day, and almost nothing that broke was the model. This session walks the queues, checkpoints, and blast-radius isolation that made the fleet dependable. You will leave with the checklist we now apply before any agent workload ships.', 'pending',       'u_speaker', 'fmt_breakout', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_acceptq',  'e_demo', 'form_sessions', 'session', 'Eval-driven agent design',        'Most agent demos die in the gap between a cherry-picked transcript and a Tuesday-afternoon user. This talk shows how a 400-scenario eval suite, judges we actually trust, and CI gates restructured how the team ships agent behavior. Expect concrete artifacts: scenario schema, judge prompts, and the dashboard that ended the weekly argument.', 'accept_queue',  'u_speaker', 'fmt_breakout', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_accepted', 'e_demo', 'form_sessions', 'session', 'Retrieval that holds up in production', 'Retrieval went from research afterthought to the load-bearing wall of production AI, and most of what made it work for us was not in any paper. This keynote traces one retrieval stack over three years: naive vector search, the hybrid rebuild, and the freshness pipeline that kept answers true after the docs changed. If you are building on retrieval in 2026, this is the map of the potholes.', 'accepted',      'u_speaker', 'fmt_keynote',  'lvl_intro', unixepoch('2026-10-12 17:00'), unixepoch('2026-10-12 17:45'), 'room_a', unixepoch(), unixepoch()),
 ('s_accepted2','e_demo', 'form_sessions', 'session', 'Agents in the enterprise',        'Shipping an agent inside a 40,000-person company is a different sport from shipping one to developers. The blockers are rarely technical: procurement, audit trails, and proving which data the model saw. This session covers the permission-scoped tools and human-approval checkpoints that got three deployments through those gates.', 'accepted',      'u_speaker', 'fmt_breakout', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_declineq', 'e_demo', 'form_sessions', 'session', 'OrbitOps: one pane of glass for enterprise AI', 'In this session I will present OrbitOps, our end-to-end enterprise AI orchestration suite. OrbitOps unifies prompt management, agent deployment, observability, and governance in a single pane of glass, powered by our proprietary AutoTune engine. Attendees receive an extended trial license and a discount code for annual plans.', 'decline_queue', 'u_speaker', 'fmt_breakout', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_declined', 'e_demo', 'form_sessions', 'session', 'Running an engineering team after the hype', 'Every hype cycle ends, and engineering organizations are left holding whatever they hired and promised at the peak. This talk is a field guide to sunsetting the projects that existed because of the cycle rather than the customers, and keeping the people who joined for the wrong reasons but stayed for the right ones. Drawn from two downturns of management experience.', 'declined',      'u_speaker', 'fmt_breakout', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_withdrawn','e_demo', 'form_sessions', 'session', 'The feature-flag lifecycle nobody writes down', 'Feature flags started as a deploy safety net and grew into the way our whole product organization makes decisions. This talk covers the flag debt, the permanent temporary flags, and the incident caused by a flag nobody owned — plus the quarterly cleanup playbook that got us out of it.', 'withdrawn',     'u_speaker', 'fmt_breakout', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch());

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
 ('pf_hotel',  'e_demo', 'Hotel Stay',           'Book your hotel',       'contact', '[{"name":"Hotel name","type":"text","required":true},{"name":"Check-in date","type":"date","required":true},{"name":"Check-out date","type":"date","required":true}]', unixepoch()),
 ('pf_flight', 'e_demo', 'Flight Reimbursement', 'Submit your flight',    'contact', '[{"name":"Airline","type":"text","required":true},{"name":"Amount (USD)","type":"number","required":true}]',   unixepoch());

INSERT INTO tasks (id, event_id, name, type, description, portal_form_id, is_file_request, is_onboarding_default, required, created_at) VALUES
 ('task_hotel',  'e_demo', 'Hotel & Travel Reservations', 'contact',    'Book your hotel stay.',                 'pf_hotel',  0, 1, 1, unixepoch()),
 ('task_flight', 'e_demo', 'Flight Reimbursement',        'contact',    'Submit your flight for reimbursement.', 'pf_flight', 0, 1, 1, unixepoch()),
 ('task_slides', 'e_demo', 'Presentation Upload',         'submission', 'Upload your slides.',                   NULL,        1, 1, 0, unixepoch());

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
INSERT INTO contacts (id, event_id, user_id, email, first_name, last_name, job_title, company_name, bio, created_at) VALUES
 ('c_noor',  'e_demo', NULL, 'noor.haddad@example.com',  'Noor',  'Haddad', 'VP of Engineering',   'Post-SaaS Institute', 'Noor leads engineering at the Post-SaaS Institute, where she studies what it actually costs to replace rented software with systems a team can run. She previously ran platform engineering at two infrastructure companies.', unixepoch()),
 ('c_marco', 'e_demo', NULL, 'marco.silva@example.com',  'Marco', 'Silva',  'Platform Engineer',   'SwarmScale',          'Marco runs SwarmScale''s agent control plane and spends most days in query plans and traces. He writes up the incidents that taught the team how D1 behaves under a few thousand concurrent runs.', unixepoch()),
 ('c_dana',  'e_demo', NULL, 'dana.fields@example.com',  'Dana',  'Fields', 'Program Chair',       'DevFlow Conf',        'Dana chairs DevFlow Conf and has read thousands of CFP submissions across eight programs. She moderates panels the way she runs review: with a timer and no product pitches.', unixepoch()),
 ('c_lena',  'e_demo', NULL, 'lena.ortiz@example.com',   'Lena',  'Ortiz',  'Deliverability Lead', 'Inbox Works',         'Lena leads deliverability at Inbox Works, helping event teams keep acceptance mail out of spam. She has rolled out SPF, DKIM, and DMARC across fleets of sending domains.', unixepoch());

-- SCHEDULED accepted sessions (starts_at/ends_at/room set; durations match the
-- session's format default). Oct 13 is the densest day.
INSERT INTO submissions (id, event_id, form_id, type, title, description, status, submitter_id, format_id, level_id, starts_at, ends_at, room_id, created_at, updated_at) VALUES
 -- Mon Oct 12 (Main Hall + Room 305 free 9:00 AM-2:00 PM PDT)
 ('s_open_keynote',     'e_demo', 'form_sessions', 'session', 'Opening Keynote: The State of AI Engineering', 'AI engineering stopped being a frontier discipline and started being a job description, but the tools and failure modes are still catching up. This opening keynote takes stock of where production teams actually are, drawing on conversations with more than a hundred teams over the past year. The goal is a shared map for the three days ahead.', 'accepted', 'u_speaker', 'fmt_keynote',  'lvl_intro', unixepoch('2026-10-12 15:00'), unixepoch('2026-10-12 15:45'), 'room_main', unixepoch(), unixepoch()),
 ('s_open_models',      'e_demo', 'form_sessions', 'session', 'Panel: Open Models in Production',             'Four teams run open-weight models in production today, at four very different scales, and none of them made the same choices. This panel compares serving stacks, fine-tuning strategy, evals, and what the actual invoices look like. Expect specifics rather than positioning.', 'accepted', 'u_speaker', 'fmt_panel',    'lvl_inter', unixepoch('2026-10-12 21:30'), unixepoch('2026-10-12 22:30'), 'room_main', unixepoch(), unixepoch()),
 ('s_prompt_injection', 'e_demo', 'form_sessions', 'session', 'Prompt Injection Deep Dive',                   'Prompt injection is a production security class with real incidents, and most mitigations teams reach for first do not survive contact with an attacker. This deep dive works through direct injection, indirect injection through retrieved content, and tool-call hijacking. You will leave with a layered defense checklist ordered by cost.', 'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-12 16:30'), unixepoch('2026-10-12 17:00'), 'room_wsb',  unixepoch(), unixepoch()),
 ('s_finetune_ws',      'e_demo', 'form_sessions', 'session', 'Hands-on: Fine-tuning Small Models',           'Bring a laptop, leave with a model. In 90 minutes we take a 3B-parameter open model from base weights to a fine-tune that beats a model ten times its size on one specific support-routing task. No GPU required on your machine — notebooks are provisioned. Comfort with Python is assumed, prior fine-tuning experience is not.', 'accepted', 'u_speaker', 'fmt_workshop', 'lvl_inter', unixepoch('2026-10-12 18:00'), unixepoch('2026-10-12 19:30'), 'room_wsb',  unixepoch(), unixepoch()),
 ('s_retrieval',        'e_demo', 'form_sessions', 'session', 'Retrieval Beyond Vectors',                     'Vector search is a great first chapter and a terrible whole book. This talk walks the hybrid architecture we converged on after two rebuilds: lexical search for precision, embeddings for recall, structured filters for correctness, and a reranker to arbitrate. Practical throughout: schemas, query plans, and the fusion function doing most of the work.', 'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-12 20:00'), unixepoch('2026-10-12 20:30'), 'room_a',    unixepoch(), unixepoch()),
 ('s_budget_llms',      'e_demo', 'form_sessions', 'session', 'Serving LLMs on a Budget',                     'Our inference bill was on track to pass our payroll. This talk is the story of cutting tokens-per-dollar by 7x without a visible quality drop, in the order the savings actually arrived. Every technique comes with the eval evidence we used to prove it to a skeptical product team.', 'accepted', 'u_speaker', 'fmt_talk',     'lvl_intro', unixepoch('2026-10-12 17:00'), unixepoch('2026-10-12 17:30'), 'room_b',    unixepoch(), unixepoch()),
 ('s_evals_ws',         'e_demo', 'form_sessions', 'session', 'Hands-on: Evals from Scratch',                 'Evals are the highest-leverage infrastructure an AI team can own, and the tooling matters far less than the muscle. In this hands-on session we build an eval harness from an empty directory: golden sets, graders, a runner with caching, and a CI gate that blocks regressions. Bring a laptop with Python.', 'accepted', 'u_speaker', 'fmt_workshop', 'lvl_inter', unixepoch('2026-10-12 21:30'), unixepoch('2026-10-12 23:00'), 'room_305',  unixepoch(), unixepoch()),
 -- Tue Oct 13 (densest day)
 ('s_postcloud',        'e_demo', 'form_sessions', 'session', 'Keynote: The Post-Cloud Developer',            'The console was never the product — it was the interim UI for infrastructure that could not yet describe itself. This keynote argues that the next platform shift is already visible: infrastructure declared next to application code, and agents as the first users of every API. Opinionated, and intended to start arguments that last all three days.', 'accepted', 'u_speaker', 'fmt_keynote',  'lvl_intro', unixepoch('2026-10-13 16:00'), unixepoch('2026-10-13 16:45'), 'room_main', unixepoch(), unixepoch()),
 ('s_inference_econ',   'e_demo', 'form_sessions', 'session', 'Panel: The Economics of Inference',            'Everyone in this industry is spending someone else''s margin. This panel brings together a capacity buyer, a compute economist, and an infrastructure lead who moved a workload across three providers in a year. On the table: where prices are actually heading, and how to write a capacity plan you will not regret in six months.', 'accepted', 'u_speaker', 'fmt_panel',    'lvl_inter', unixepoch('2026-10-13 18:00'), unixepoch('2026-10-13 19:00'), 'room_main', unixepoch(), unixepoch()),
 ('s_agents_ship',      'e_demo', 'form_sessions', 'session', 'Agents that Ship: Case Studies',               'Three agents made it to production. One triages support tickets, one migrates legacy code, one runs infrastructure remediations. All three nearly died in month two, each for a different reason. For each: the failure, the detection gap, the fix, and the metric we now watch.', 'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-13 21:00'), unixepoch('2026-10-13 21:30'), 'room_main', unixepoch(), unixepoch()),
 ('s_llm_obs_ws',       'e_demo', 'form_sessions', 'session', 'Hands-on: Observability for LLM Apps',         'You cannot fix what you cannot see, and most LLM apps ship blind. This workshop builds the observability stack for an AI application: structured traces for every model call, cost attribution per feature, and online evals on production traffic. Laptop required. You leave with the instrumented repo and the dashboards.', 'accepted', 'u_speaker', 'fmt_workshop', 'lvl_inter', unixepoch('2026-10-13 16:30'), unixepoch('2026-10-13 18:00'), 'room_wsb',  unixepoch(), unixepoch()),
 ('s_structured_out',   'e_demo', 'form_sessions', 'session', 'Structured Output at Scale',                   'Parsing model output with regexes is how you end up debugging production at midnight. This talk covers designing schemas the model can actually satisfy, retry ladders that repair rather than regenerate, and the throughput cost of constrained decoding measured properly. Includes a year of failure-rate data from migrating extraction pipelines.', 'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-13 20:00'), unixepoch('2026-10-13 20:30'), 'room_wsb',  unixepoch(), unixepoch()),
 ('s_localfirst',       'e_demo', 'form_sessions', 'session', 'Local-first AI Apps',                          'The most reliable AI app is the one that keeps working in airplane mode. This talk covers on-device inference with server fallback, embedding sync that respects bandwidth and privacy, and the UX contract for smart features that degrade gracefully offline. Demoed live on a laptop with the network off.', 'accepted', 'u_speaker', 'fmt_talk',     'lvl_intro', unixepoch('2026-10-13 17:00'), unixepoch('2026-10-13 17:30'), 'room_305',  unixepoch(), unixepoch()),
 ('s_build_buy',        'e_demo', 'form_sessions', 'session', 'Panel: Build vs Buy for AI Platforms',         'Every platform team eventually faces the question: build the AI platform layer or buy it. Both answers are expensive and one of them is wrong for you specifically. This panel stages the argument with a lead who built, one who bought, and one who did each and switched.', 'accepted', 'u_speaker', 'fmt_panel',    'lvl_intro', unixepoch('2026-10-13 22:00'), unixepoch('2026-10-13 23:00'), 'room_305',  unixepoch(), unixepoch()),
 ('s_llm_caching',      'e_demo', 'form_sessions', 'session', 'Caching Strategies for LLM APIs',              'The fastest and cheapest LLM call is the one you never make. This talk maps the caching ladder from exact-match response caches to full semantic caches with similarity thresholds. For each rung: the hit rates we measured, the invalidation strategy that keeps it honest, and the incident that taught us where the threshold belongs.', 'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-13 18:30'), unixepoch('2026-10-13 19:00'), 'room_a',    unixepoch(), unixepoch()),
 ('s_multimodal',       'e_demo', 'form_sessions', 'session', 'Multimodal Pipelines in Practice',             'The interesting documents were never plain text. This session walks one production document pipeline end to end: layout-aware chunking, when vision models beat OCR, grounding extraction against source regions, and evals for outputs where mostly right is not a number. Benchmarks come from two million processed pages.', 'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-13 23:00'), unixepoch('2026-10-13 23:30'), 'room_b',    unixepoch(), unixepoch()),
 -- Wed Oct 14
 ('s_cfp_design',       'e_demo', 'form_sessions', 'session', 'Designing Speaker-first CFPs',                 'Speakers meet your conference twice: once through the CFP form, once on stage. Most events lose great talks at the first meeting. This talk turns eight years of program-chair data into form design guidance: the question budget, what belongs at submission versus after acceptance, and review transparency that keeps declined speakers coming back.', 'accepted', 'u_speaker', 'fmt_talk',     'lvl_intro', unixepoch('2026-10-14 16:00'), unixepoch('2026-10-14 16:30'), 'room_main', unixepoch(), unixepoch()),
 ('s_closing_panel',    'e_demo', 'form_sessions', 'session', 'Closing Panel: Where Do We Go From Here?',     'Three days, five tracks, and several hundred hallway arguments deserve a synthesis. The closing panel brings program voices back on stage to separate what we actually learned this week from what merely sounded good in a keynote. Audience questions take the second half — bring the argument you did not get to finish.', 'accepted', 'u_speaker', 'fmt_panel',    'lvl_intro', unixepoch('2026-10-14 23:00'), unixepoch('2026-10-15 00:00'), 'room_main', unixepoch(), unixepoch()),
 ('s_confsite_ws',      'e_demo', 'form_sessions', 'session', 'Hands-on: Shipping a Conference Site in a Day','A conference program is a database with an audience, so treat it like one. In this workshop we ship a complete conference site in a day: sessions catalog, speaker directory, schedule grid, and calendar feeds. Bring a laptop with Node installed. Every attendee leaves with their own deployed site and the repo to keep.', 'accepted', 'u_speaker', 'fmt_workshop', 'lvl_inter', unixepoch('2026-10-14 17:00'), unixepoch('2026-10-14 18:30'), 'room_wsb',  unixepoch(), unixepoch()),
 ('s_post_transformer', 'e_demo', 'form_sessions', 'session', 'The Post-Transformer Landscape',               'The transformer has been the answer for eight years, which historically is when architectures stop being the answer. This talk surveys state-space models, hybrid attention, and the sparse and recurrent revivals — what the benchmarks actually show once you control for training budget, and what a production team should do about any of this now.', 'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-14 18:00'), unixepoch('2026-10-14 18:30'), 'room_305',  unixepoch(), unixepoch()),
 ('s_d1_migrations',    'e_demo', 'form_sessions', 'session', 'Zero-downtime Migrations on D1',               'SQLite at the edge changes what a migration even is: no maintenance window, and a write path you share with live traffic. This talk is the expand-and-contract playbook adapted for D1, including the migration that went wrong and the guardrail that now prevents it.', 'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', unixepoch('2026-10-14 21:00'), unixepoch('2026-10-14 21:30'), 'room_a',    unixepoch(), unixepoch());

-- UNSCHEDULED accepted sessions — the five scenario-named drag fixtures
-- (no starts_at/ends_at/room; they live in the Unscheduled panel).
INSERT INTO submissions (id, event_id, form_id, type, title, description, status, submitter_id, format_id, level_id, starts_at, ends_at, room_id, created_at, updated_at) VALUES
 ('s_closing_keynote', 'e_demo', 'form_sessions', 'session', 'Closing Keynote: The Post-SaaS Stack',      'The subscription wall was a billing model that grew into an architecture, and it is quietly coming apart. This closing keynote maps which categories flipped first, what happens to total cost when licenses go away and operations come home, and the failure stories from teams that self-hosted more than they could operate.', 'accepted', 'u_speaker', 'fmt_keynote',  'lvl_intro', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_live_demo',       'e_demo', 'form_sessions', 'session', 'Live Demo: Agent Swarms in Production',     'No slides, just terminals. This is a live tour of a production agent swarm doing real work: specialized agents coordinating with checkpoints, retries, and a shared control plane. We will kill a worker mid-task to watch recovery happen. If the demo gods frown, the failure analysis is the content.', 'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_office_hours',    'e_demo', 'form_sessions', 'session', 'Office Hours: D1 Performance Clinic',       'Bring your slow queries. This is an open working session, not a talk: we put real query plans from the audience on screen and fix them together — missing indexes, accidental full scans, and the D1-specific costs that surprise teams arriving from client-server databases.', 'accepted', 'u_speaker', 'fmt_talk',     'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_panel_cfp',       'e_demo', 'form_sessions', 'session', 'Panel: Is the CFP Dead?',                   'Open CFPs are democratic, slow, and increasingly gamed. Pure curation is fast, biased, and books the same twelve speakers every circuit. Three chairs with three very different models bring their actual numbers: submission volumes, acceptance rates, speaker-diversity outcomes, and audience scores.', 'accepted', 'u_speaker', 'fmt_panel',    'lvl_intro', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_workshop_email',  'e_demo', 'form_sessions', 'session', 'Workshop: Own Your Email Deliverability',   'Your conference emails are landing in spam and nobody is telling you. This hands-on workshop sets up SPF, DKIM, and DMARC on a real domain live, misconfigures each one to see the exact failure, then reads the DMARC reports that tell you what the inbox providers actually saw. Bring a domain you control.', 'accepted', 'u_speaker', 'fmt_workshop', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch());

-- Non-schedulable negative fixtures (AG-S1.4 / AG-S5.3): neither may appear in
-- the Unscheduled panel while schedulable statuses = ['accepted'].
INSERT INTO submissions (id, event_id, form_id, type, title, description, status, submitter_id, format_id, level_id, starts_at, ends_at, room_id, created_at, updated_at) VALUES
 ('s_soc2',        'e_demo', 'form_sessions', 'session', 'SOC 2 for Startups: A War Story', 'We got SOC 2 Type II with two engineers, no compliance hire, and a tooling budget that embarrassed our auditor. This talk is the honest war story: what the framework actually requires versus what vendors imply it requires, and where we nearly failed the audit.', 'pending',      'u_speaker', 'fmt_talk', 'lvl_intro', NULL, NULL, NULL, unixepoch(), unixepoch()),
 ('s_gpu_pricing', 'e_demo', 'form_sessions', 'session', 'GPU Pricing Deep Dive',           'GPU pricing is a market with three-year contracts on one end, spot preemptions on the other, and very little honest guidance in between. This deep dive builds the mental model and comes with a year of procurement data across four providers, anonymized but real.', 'accept_queue', 'u_speaker', 'fmt_talk', 'lvl_inter', NULL, NULL, NULL, unixepoch(), unixepoch());

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
