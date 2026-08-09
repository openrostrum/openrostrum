-- Deterministic demo baseline for local dev + tests. Applied via `pnpm db:seed`
-- (and `pnpm db:reset`). Timestamps are unix seconds (unixepoch()), matching
-- Drizzle's integer timestamp mode. Password hashes are placeholders until the
-- auth module seeds real PBKDF2 hashes.

DELETE FROM submission_tracks;
DELETE FROM participants;
DELETE FROM submissions;
DELETE FROM tracks;
DELETE FROM events;
DELETE FROM users;
DELETE FROM email_outbox;

INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES
 ('u_admin',   'admin@example.com',   'seed:replace-with-real-hash', 'Demo Admin', 'admin',   unixepoch()),
 ('u_speaker', 'speaker@example.com', 'seed:replace-with-real-hash', 'Sam Speaker', 'speaker', unixepoch());

INSERT INTO events (id, name, slug, timezone, starts_at, ends_at, created_at) VALUES
 ('e_demo', 'AI.Engineer Sandbox Event', 'ai-engineer-sandbox', 'America/Los_Angeles',
  unixepoch('2026-10-12'), unixepoch('2026-10-14'), unixepoch());

INSERT INTO tracks (id, event_id, name, color, created_at) VALUES
 ('t_innovation', 'e_demo', 'Innovation', '#6366f1', unixepoch()),
 ('t_practice',   'e_demo', 'Practice',   '#10b981', unixepoch());

INSERT INTO submissions (id, event_id, title, description, status, submitter_id, format, level, language, created_at, updated_at) VALUES
 ('s_1', 'e_demo', 'Scaling LLM agents in production', 'A deep dive into running agent swarms reliably.', 'pending',  'u_speaker', 'Breakout',         'Intermediate',  'English', unixepoch(), unixepoch()),
 ('s_2', 'e_demo', 'From RAG to riches',               'A keynote on retrieval-augmented systems.',       'accepted', 'u_speaker', 'Featured Keynote', 'Introductory', 'English', unixepoch(), unixepoch());

INSERT INTO submission_tracks (submission_id, track_id) VALUES
 ('s_1', 't_innovation'),
 ('s_2', 't_practice');

INSERT INTO participants (id, submission_id, user_id, first_name, last_name, email, role, bio, created_at) VALUES
 ('p_1', 's_1', 'u_speaker', 'Sam', 'Speaker', 'speaker@example.com', 'speaker', 'Builder of agents.', unixepoch()),
 ('p_2', 's_2', 'u_speaker', 'Sam', 'Speaker', 'speaker@example.com', 'speaker', 'Builder of agents.', unixepoch());
