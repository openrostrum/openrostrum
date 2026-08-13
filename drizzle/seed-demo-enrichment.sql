-- Idempotent enrichment scoped to the fixed e_demo rows seeded by seed.sql.
-- Safe for direct remote execution; upload the verified R2 bundle first so
-- live file rows never point at missing objects. Runbook: docs/JUDGING.md.
--
-- Identity updates run first so a live D1 that still holds the old sandbox
-- name, slug, or dummy people becomes Northbound without a full reseed.

UPDATE events
 SET name = 'Northbound AI Summit 2026',
     slug = 'northbound-ai-summit-2026',
     location = 'Yerba Buena Center for the Arts, San Francisco, California'
 WHERE id = 'e_demo' AND organization_id = 'org_demo';

UPDATE organizations
 SET name = 'Northbound Collective'
 WHERE id = 'org_demo';

UPDATE users SET name = 'Chris Okada' WHERE id = 'u_admin' AND email = 'admin@example.com';
UPDATE users SET name = 'Samira Cole' WHERE id = 'u_speaker' AND email = 'speaker@example.com';
UPDATE users SET name = 'Riley Okonkwo' WHERE id = 'u_reviewer' AND email = 'reviewer@example.com';

UPDATE contacts
 SET first_name = 'Samira', last_name = 'Cole',
     job_title = 'Staff Engineer', company_name = 'Latticework'
 WHERE id = 'c_sam' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = contacts.event_id AND e.organization_id = 'org_demo');

UPDATE contacts
 SET first_name = 'Alex', last_name = 'Moreau',
     job_title = 'Developer Advocate', company_name = 'Harborline'
 WHERE id = 'c_alex' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = contacts.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET title = 'Three layers of agent memory'
 WHERE id = 's_draft' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');
UPDATE submissions SET title = 'Retrieval that holds up in production'
 WHERE id = 's_accepted' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');
UPDATE submissions SET title = 'OrbitOps: one pane of glass for enterprise AI'
 WHERE id = 's_declineq' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');
UPDATE submissions SET title = 'Running an engineering team after the hype'
 WHERE id = 's_declined' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');
UPDATE submissions SET title = 'The feature-flag lifecycle nobody writes down'
 WHERE id = 's_withdrawn' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');


-- Named speakers push the public directory past its 30-row page size; missing
-- photos remain intentional fallback-state coverage.
WITH seed_contacts (id, event_id, email, first_name, last_name, job_title, company_name, bio, status, created_at) AS (
 VALUES
 ('c_maya',     'e_demo', 'maya.chen@example.com',        'Maya',     'Chen',       'VP, AI Platform',                'Northstar Systems',       'Maya leads the AI platform organization at Northstar Systems, where her teams operate shared inference, retrieval, and evaluation services for hundreds of product engineers. She previously built distributed systems at two developer infrastructure companies.', 'confirmed', unixepoch()),
 ('c_omar',     'e_demo', 'omar.elamin@example.com',      'Omar',     'El-Amin',    'Open Models Lead',               'Meridian Compute',        'Omar leads open-model deployment at Meridian Compute and has taken language models from research checkpoints to regulated production workloads. His work focuses on serving economics, reproducible evaluation, and the operational trade-offs behind model ownership.', 'confirmed', unixepoch()),
 ('c_priya',    'e_demo', 'priya.narayanan@example.com',  'Priya',    'Narayanan',  'Principal Security Researcher',  'Boundary Labs',           'Priya researches how language-model applications fail at trust boundaries, with a focus on indirect prompt injection and tool authorization. At Boundary Labs she partners with product teams to turn red-team findings into practical, layered controls.', 'confirmed', unixepoch()),
 ('c_luca',     'e_demo', 'luca.bianchi@example.com',     'Luca',     'Bianchi',    'ML Systems Engineer',            'Piccolo AI',              'Luca builds compact language models and the training systems behind them at Piccolo AI. He has helped teams move narrow production tasks from frontier APIs to fine-tuned small models while preserving measurable quality.', 'confirmed', unixepoch()),
 ('c_yuki',     'e_demo', 'yuki.tanaka@example.com',      'Yuki',     'Tanaka',     'Search Infrastructure Lead',     'Kintsugi Data',           'Yuki leads search infrastructure at Kintsugi Data, combining lexical retrieval, embeddings, structured filters, and reranking in high-volume products. She writes about the evaluation failures that force retrieval teams to rebuild.', 'confirmed', unixepoch()),
 ('c_amina',    'e_demo', 'amina.okafor@example.com',     'Amina',    'Okafor',     'Director of ML Efficiency',      'Common Thread',           'Amina owns model efficiency at Common Thread, where she reduced inference cost while expanding the company model portfolio. Her team measures every optimization against held-out quality and publishes an internal tokens-per-dollar index.', 'confirmed', unixepoch()),
 ('c_eli',      'e_demo', 'eli.rosenberg@example.com',    'Eli',      'Rosenberg',  'Evaluation Engineer',            'Proofpoint AI',           'Eli designs evaluation systems at Proofpoint AI, from golden datasets and deterministic graders to calibrated language-model judges. They help product teams translate support incidents into regression cases that can block a release.', 'confirmed', unixepoch()),
 ('c_ines',     'e_demo', 'ines.duarte@example.com',      'Inês',     'Duarte',     'Developer Infrastructure Fellow','Local Cloud Foundation',  'Inês is a fellow at the Local Cloud Foundation studying infrastructure that assembles itself around application code. She previously led developer experience teams and now advises open-source projects on platform ergonomics.', 'confirmed', unixepoch()),
 ('c_jordan',   'e_demo', 'jordan.bell@example.com',      'Jordan',   'Bell',       'Compute Economist',              'Capacity Index',          'Jordan analyzes accelerator supply, inference pricing, and cloud capacity contracts at Capacity Index. Their research translates opaque provider markets into planning models used by engineering and finance leaders.', 'confirmed', unixepoch()),
 ('c_sofia',    'e_demo', 'sofia.alvarez@example.com',    'Sofía',    'Álvarez',    'Staff Product Engineer',         'RelayWorks',              'Sofía ships agent products at RelayWorks and owns the production feedback loop after launch. She documents incidents where technically successful agents optimized the wrong outcome, then turns each failure into a durable guardrail.', 'confirmed', unixepoch()),
 ('c_tomas',    'e_demo', 'tomas.novak@example.com',      'Tomáš',    'Novák',      'Observability Architect',        'Tracegarden',             'Tomáš builds tracing and online-evaluation systems for language-model applications at Tracegarden. He specializes in making latency, token cost, tool calls, and semantic quality visible in one production trace.', 'confirmed', unixepoch()),
 ('c_nia',      'e_demo', 'nia.brooks@example.com',       'Nia',      'Brooks',     'Applied AI Lead',                'SchemaWorks',             'Nia leads applied AI at SchemaWorks, where structured generation replaced dozens of fragile extraction pipelines. Her work covers constrained decoding, semantic validation, repair strategies, and schema design that models can reliably satisfy.', 'confirmed', unixepoch()),
 ('c_kenji',    'e_demo', 'kenji.sato@example.com',       'Kenji',    'Sato',       'On-device ML Engineer',          'Pocket Models',           'Kenji builds local-first intelligence at Pocket Models, spanning on-device inference, private retrieval, and graceful server fallback. He tests every demonstration offline so the architecture cannot hide a network dependency.', 'confirmed', unixepoch()),
 ('c_fatima',   'e_demo', 'fatima.zahra@example.com',     'Fatima',   'Zahra',      'Head of Platform',               'Atlas Commerce',          'Fatima leads the platform group at Atlas Commerce and has both built and bought internal AI infrastructure. She advises teams on the organizational and compliance variables that matter more than a feature comparison.', 'confirmed', unixepoch()),
 ('c_ben',      'e_demo', 'benjamin.liu@example.com',     'Benjamin', 'Liu',        'Principal Engineer',             'Cacheline AI',            'Benjamin is a principal engineer at Cacheline AI focused on safe caching for model-backed products. He has operated exact, prefix, retrieval, and semantic caches and keeps a detailed archive of the invalidation incidents each one caused.', 'confirmed', unixepoch()),
 ('c_zara',     'e_demo', 'zara.amin@example.com',        'Zara',     'Amin',       'Document Intelligence Lead',     'Papertrail Health',       'Zara leads document intelligence at Papertrail Health, processing forms and clinical records where extraction must be traceable to source pixels. Her team combines layout models, vision systems, and human-verifiable grounding.', 'confirmed', unixepoch()),
 ('c_michelle', 'e_demo', 'michelle.okoro@example.com',   'Michelle', 'Okoro',      'Executive Director',             'Speaker First',           'Michelle runs Speaker First and has studied completion and acceptance patterns across years of conference calls for proposals. She helps program teams shorten forms, support first-time speakers, and make review decisions more transparent.', 'confirmed', unixepoch()),
 ('c_arthur',   'e_demo', 'arthur.dubois@example.com',    'Arthur',   'Dubois',     'Editor',                         'Practical AI Review',     'Arthur edits Practical AI Review, where he turns production case studies into deeply reported technical features. He has moderated engineering panels on five continents and is known for insisting on numbers behind every prediction.', 'confirmed', unixepoch()),
 ('c_rohan',    'e_demo', 'rohan.mehta@example.com',      'Rohan',    'Mehta',      'Founder',                        'Stagecraft Open Source',  'Rohan founded Stagecraft Open Source to give community conferences fast, maintainable program sites without platform fees. He works across data modeling, web performance, accessibility, and the operational reality of event-day edits.', 'confirmed', unixepoch()),
 ('c_elena',    'e_demo', 'elena.petrova@example.com',    'Elena',    'Petrova',    'Research Engineering Director',  'Gradient Commons',        'Elena directs research engineering at Gradient Commons, where her group evaluates state-space, recurrent, sparse, and hybrid model architectures under matched training budgets. She focuses on evidence that production teams can act on.', 'confirmed', unixepoch()),
 ('c_malik',    'e_demo', 'malik.thompson@example.com',   'Malik',    'Thompson',   'Database Reliability Engineer',  'Edge Ledger',             'Malik is a database reliability engineer at Edge Ledger and has guided dozens of live D1 schema changes. He teaches expand-and-contract migrations, bounded backfills, and verification queries that make edge-database cutovers boring.', 'confirmed', unixepoch()),
 ('c_adwoa',    'e_demo', 'adwoa.mensah@example.com',     'Adwoa',    'Mensah',     'Model Operations Director',      'Sankofa Compute',         'Adwoa runs model operations at Sankofa Compute, where her team serves open-weight models for products across Africa and Europe. She focuses on reliability, multilingual quality, and the staffing cost that rarely appears in benchmark comparisons.', 'confirmed', unixepoch()),
 ('c_isaac',    'e_demo', 'isaac.kim@example.com',        'Isaac',    'Kim',        'Capacity Strategy Lead',         'Tessellate Cloud',        'Isaac leads accelerator capacity strategy at Tessellate Cloud and negotiates reserved, on-demand, and spot portfolios for large inference fleets. He turns utilization traces and product forecasts into procurement decisions.', 'confirmed', unixepoch()),
 ('c_layla',    'e_demo', 'layla.hassan@example.com',     'Layla',    'Hassan',     'VP of Engineering',              'Harbor Finance',          'Layla is VP of Engineering at Harbor Finance, where she moved a regulated AI platform from a vendor bundle to an internal stack and later moved selected layers back. She speaks candidly about ownership cost and organizational fit.', 'confirmed', unixepoch()),
 ('c_grace',    'e_demo', 'grace.wu@example.com',         'Grace',    'Wu',         'Program Director',               'Systems Forum',           'Grace directs the Systems Forum conference program and has built technical agendas across infrastructure, databases, and applied AI. She is known for closing panels that turn three days of claims into specific, testable predictions.', 'confirmed', unixepoch())
)
INSERT OR IGNORE INTO contacts (id, event_id, email, first_name, last_name, job_title, company_name, bio, status, created_at)
SELECT id, event_id, email, first_name, last_name, job_title, company_name, bio, status, created_at
FROM seed_contacts
WHERE EXISTS (
 SELECT 1 FROM events e
 WHERE e.id = seed_contacts.event_id AND e.organization_id = 'org_demo'
);

WITH seed_participants (id, submission_id, contact_id, role, is_primary, position, created_at) AS (
 VALUES
 ('p_maya_open',       's_open_keynote',     'c_maya',     'speaker', 1, 0, unixepoch()),
 ('p_omar_models',     's_open_models',      'c_omar',     'speaker', 1, 0, unixepoch()),
 ('p_priya_injection', 's_prompt_injection', 'c_priya',    'speaker', 1, 0, unixepoch()),
 ('p_luca_finetune',   's_finetune_ws',      'c_luca',     'speaker', 1, 0, unixepoch()),
 ('p_yuki_retrieval',  's_retrieval',        'c_yuki',     'speaker', 1, 0, unixepoch()),
 ('p_amina_budget',    's_budget_llms',      'c_amina',    'speaker', 1, 0, unixepoch()),
 ('p_eli_evals',       's_evals_ws',         'c_eli',      'speaker', 1, 0, unixepoch()),
 ('p_ines_postcloud',  's_postcloud',        'c_ines',     'speaker', 1, 0, unixepoch()),
 ('p_jordan_econ',     's_inference_econ',   'c_jordan',   'speaker', 1, 0, unixepoch()),
 ('p_sofia_agents',    's_agents_ship',      'c_sofia',    'speaker', 1, 0, unixepoch()),
 ('p_tomas_obs',       's_llm_obs_ws',       'c_tomas',    'speaker', 1, 0, unixepoch()),
 ('p_nia_structured',  's_structured_out',   'c_nia',      'speaker', 1, 0, unixepoch()),
 ('p_kenji_local',     's_localfirst',        'c_kenji',    'speaker', 1, 0, unixepoch()),
 ('p_fatima_build',    's_build_buy',        'c_fatima',   'speaker', 1, 0, unixepoch()),
 ('p_ben_cache',       's_llm_caching',      'c_ben',      'speaker', 1, 0, unixepoch()),
 ('p_zara_multi',      's_multimodal',       'c_zara',     'speaker', 1, 0, unixepoch()),
 ('p_michelle_cfp',    's_cfp_design',       'c_michelle', 'speaker', 1, 0, unixepoch()),
 ('p_arthur_closing',  's_closing_panel',    'c_arthur',   'speaker', 1, 0, unixepoch()),
 ('p_rohan_confsite',  's_confsite_ws',      'c_rohan',    'speaker', 1, 0, unixepoch()),
 ('p_elena_post',      's_post_transformer', 'c_elena',    'speaker', 1, 0, unixepoch()),
 ('p_malik_d1',        's_d1_migrations',    'c_malik',    'speaker', 1, 0, unixepoch()),
 ('p_adwoa_models',    's_open_models',      'c_adwoa',    'speaker', 0, 1, unixepoch()),
 ('p_isaac_econ',      's_inference_econ',   'c_isaac',    'speaker', 0, 1, unixepoch()),
 ('p_layla_build',     's_build_buy',        'c_layla',    'speaker', 0, 1, unixepoch()),
 ('p_grace_closing',   's_closing_panel',    'c_grace',    'moderator', 0, 1, unixepoch())
)
INSERT OR IGNORE INTO participants (id, submission_id, contact_id, role, is_primary, position, created_at)
SELECT seed.id, seed.submission_id, seed.contact_id, seed.role,
 seed.is_primary, seed.position, seed.created_at
FROM seed_participants seed
JOIN submissions s ON s.id = seed.submission_id AND s.event_id = 'e_demo'
JOIN contacts c ON c.id = seed.contact_id AND c.event_id = s.event_id
JOIN events e ON e.id = s.event_id AND e.organization_id = 'org_demo';

-- Agenda/session detail only render Track when a session has one. Caching
-- Strategies was accepted, approved, and scheduled but untracked, so its
-- public detail had no Track row.
INSERT OR IGNORE INTO submission_tracks (submission_id, track_id)
SELECT s.id, t.id
FROM submissions s
JOIN tracks t ON t.id = 't_aiinfra' AND t.event_id = s.event_id
JOIN events e ON e.id = s.event_id AND e.organization_id = 'org_demo'
WHERE s.id = 's_llm_caching' AND s.event_id = 'e_demo';

-- Real uploads keep the versioned file chain and contacts.headshot_key aligned.
-- Conflict updates preserve any file comments attached after the first seed.
WITH seed_headshots (id, event_id, contact_id, r2_key, file_name, kind, content_type, size_bytes, version, created_at) AS (
 VALUES
 ('file_hs_sam',   'e_demo', 'c_sam',   'headshots/e_demo/c_sam/seed.png',   'sam-speaker.png',       'headshot', 'image/png', 3593, 1, unixepoch()),
 ('file_hs_alex',  'e_demo', 'c_alex',  'headshots/e_demo/c_alex/seed.png',  'alex-co.png',           'headshot', 'image/png', 4026, 1, unixepoch()),
 ('file_hs_noor',  'e_demo', 'c_noor',  'headshots/e_demo/c_noor/seed.png',  'noor-haddad.png',       'headshot', 'image/png', 4276, 1, unixepoch()),
 ('file_hs_marco', 'e_demo', 'c_marco', 'headshots/e_demo/c_marco/seed.png', 'marco-silva.png',       'headshot', 'image/png', 3749, 1, unixepoch()),
 ('file_hs_dana',  'e_demo', 'c_dana',  'headshots/e_demo/c_dana/seed.png',  'dana-fields.png',       'headshot', 'image/png', 3618, 1, unixepoch()),
 ('file_hs_lena',  'e_demo', 'c_lena',  'headshots/e_demo/c_lena/seed.png',  'lena-ortiz.png',        'headshot', 'image/png', 3944, 1, unixepoch()),
 ('file_hs_maya',  'e_demo', 'c_maya',  'headshots/e_demo/c_maya/seed.png',  'maya-chen.png',         'headshot', 'image/png', 3971, 1, unixepoch()),
 ('file_hs_priya', 'e_demo', 'c_priya', 'headshots/e_demo/c_priya/seed.png', 'priya-narayanan.png',   'headshot', 'image/png', 3797, 1, unixepoch()),
 ('file_hs_yuki',  'e_demo', 'c_yuki',  'headshots/e_demo/c_yuki/seed.png',  'yuki-tanaka.png',       'headshot', 'image/png', 3618, 1, unixepoch()),
 ('file_hs_amina', 'e_demo', 'c_amina', 'headshots/e_demo/c_amina/seed.png', 'amina-okafor.png',      'headshot', 'image/png', 4032, 1, unixepoch()),
 ('file_hs_sofia', 'e_demo', 'c_sofia', 'headshots/e_demo/c_sofia/seed.png', 'sofia-alvarez.png',     'headshot', 'image/png', 4027, 1, unixepoch()),
 ('file_hs_rohan', 'e_demo', 'c_rohan', 'headshots/e_demo/c_rohan/seed.png', 'rohan-mehta.png',       'headshot', 'image/png', 3702, 1, unixepoch())
)
INSERT INTO files (id, event_id, contact_id, r2_key, file_name, kind, content_type, size_bytes, version, created_at)
SELECT seed.id, seed.event_id, seed.contact_id, seed.r2_key, seed.file_name,
 seed.kind, seed.content_type, seed.size_bytes, seed.version, seed.created_at
FROM seed_headshots seed
JOIN contacts c ON c.id = seed.contact_id AND c.event_id = seed.event_id
JOIN events e ON e.id = seed.event_id AND e.organization_id = 'org_demo'
WHERE 1
ON CONFLICT(id) DO UPDATE SET
 event_id = excluded.event_id,
 contact_id = excluded.contact_id,
 r2_key = excluded.r2_key,
 file_name = excluded.file_name,
 kind = excluded.kind,
 content_type = excluded.content_type,
 size_bytes = excluded.size_bytes,
 version = excluded.version
WHERE files.event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = files.event_id AND e.organization_id = 'org_demo');

UPDATE contacts
 SET headshot_key = (
  SELECT f.r2_key FROM files f
  WHERE f.event_id = contacts.event_id
   AND f.contact_id = contacts.id
   AND f.kind = 'headshot'
  ORDER BY f.version DESC, f.created_at DESC, f.id DESC
  LIMIT 1
 )
 WHERE event_id = 'e_demo'
  AND id IN ('c_sam', 'c_alex', 'c_noor', 'c_marco', 'c_dana', 'c_lena',
   'c_maya', 'c_priya', 'c_yuki', 'c_amina', 'c_sofia', 'c_rohan')
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = contacts.event_id AND e.organization_id = 'org_demo');

-- Real PDF decks keep the completed upload task, file library, downloads, and
-- R2 binding on one consistent artifact chain.
WITH seed_slides (id, event_id, submission_id, contact_id, task_assignment_id, r2_key, file_name, kind, content_type, size_bytes, version, review_status, created_at) AS (
 VALUES
 ('file_slides_rag',     'e_demo', 's_accepted',    'c_sam',  'ta_3', 'slides/e_demo/s_accepted/v1.pdf',    'rag-to-riches.pdf',      'slides', 'application/pdf', 1532, 1, 'approved', unixepoch()),
 ('file_slides_opening', 'e_demo', 's_open_keynote','c_maya', NULL,   'slides/e_demo/s_open_keynote/v1.pdf', 'opening-keynote.pdf',     'slides', 'application/pdf', 1508, 1, 'approved', unixepoch()),
 ('file_slides_evals',   'e_demo', 's_evals_ws',    'c_eli',  NULL,   'slides/e_demo/s_evals_ws/v1.pdf',     'evals-from-scratch.pdf', 'slides', 'application/pdf', 1544, 1, 'approved', unixepoch())
)
INSERT INTO files (id, event_id, submission_id, contact_id, task_assignment_id, r2_key, file_name, kind, content_type, size_bytes, version, review_status, created_at)
SELECT seed.id, seed.event_id, seed.submission_id, seed.contact_id,
 seed.task_assignment_id, seed.r2_key, seed.file_name, seed.kind,
 seed.content_type, seed.size_bytes, seed.version, seed.review_status,
 seed.created_at
FROM seed_slides seed
JOIN submissions s ON s.id = seed.submission_id AND s.event_id = seed.event_id
JOIN contacts c ON c.id = seed.contact_id AND c.event_id = seed.event_id
JOIN events e ON e.id = seed.event_id AND e.organization_id = 'org_demo'
LEFT JOIN task_assignments ta ON ta.id = seed.task_assignment_id
LEFT JOIN tasks t ON t.id = ta.task_id AND t.event_id = seed.event_id
WHERE seed.task_assignment_id IS NULL OR t.id IS NOT NULL
ON CONFLICT(id) DO UPDATE SET
 event_id = excluded.event_id,
 submission_id = excluded.submission_id,
 contact_id = excluded.contact_id,
 task_assignment_id = excluded.task_assignment_id,
 r2_key = excluded.r2_key,
 file_name = excluded.file_name,
 kind = excluded.kind,
 content_type = excluded.content_type,
 size_bytes = excluded.size_bytes,
 version = excluded.version,
 review_status = excluded.review_status
WHERE files.event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = files.event_id AND e.organization_id = 'org_demo');

UPDATE task_assignments
 SET file_key = 'slides/e_demo/s_accepted/v1.pdf'
 WHERE id = 'ta_3'
  AND EXISTS (
   SELECT 1 FROM tasks t
   JOIN events e ON e.id = t.event_id AND e.organization_id = 'org_demo'
   WHERE t.id = task_assignments.task_id AND t.event_id = 'e_demo'
  );

-- Speaker bios at directory-page depth (the speakers widget shows them on the
-- detail panel, the compat API serves them as `about`).
UPDATE contacts SET bio = 'Samira leads the retrieval and memory platform at Latticework, where her team operates one of the larger production assistant fleets outside the model labs. Before that she spent six years building developer-tools infrastructure. She speaks about the unglamorous parts of AI engineering — queues, evals, and the bill.'
 WHERE id = 'c_sam' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = contacts.event_id AND e.organization_id = 'org_demo');
UPDATE contacts SET bio = 'Alex is a Developer Advocate at Harborline, where they maintain the open-source retrieval toolkit ragkit and write a long-running field-notes series on search quality. They co-host the Retrieval Roundtable podcast and have taught retrieval workshops at a dozen developer conferences.'
 WHERE id = 'c_alex' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = contacts.event_id AND e.organization_id = 'org_demo');
UPDATE contacts SET bio = 'Noor is VP of Engineering at the Post-SaaS Institute, where she studies how teams replace subscription software with open, self-hosted alternatives — and what it costs them. She previously ran platform engineering at two infrastructure companies and writes the Post-SaaS Notes newsletter.'
 WHERE id = 'c_noor' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = contacts.event_id AND e.organization_id = 'org_demo');
UPDATE contacts SET bio = 'Marco is a Platform Engineer at SwarmScale, where he runs agent swarms that peak at several thousand concurrent runs on a D1-backed control plane. He spends most days reading query plans and traces, and shares the findings on the SwarmScale engineering blog.'
 WHERE id = 'c_marco' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = contacts.event_id AND e.organization_id = 'org_demo');
UPDATE contacts SET bio = 'Dana chairs the program committee at DevFlow Conf and has read north of four thousand CFP submissions across eight years of programs. She moderates panels the way she runs review meetings — with a timer and zero patience for product pitches — and writes about program design and first-time-speaker development.'
 WHERE id = 'c_dana' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = contacts.event_id AND e.organization_id = 'org_demo');
UPDATE contacts SET bio = 'Lena leads deliverability at Inbox Works, helping event teams keep transactional and announcement email out of the spam folder. She has run SPF, DKIM, and DMARC rollouts across fleets of sending domains, and her hands-on authentication workshop is built from those migrations.'
 WHERE id = 'c_lena' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = contacts.event_id AND e.organization_id = 'org_demo');

-- Public cards truncate at 240 characters, so each abstract has real depth and
-- paragraph breaks; declined rows remain credible committee rejections.
UPDATE submissions SET description =
 'Agents forget everything between runs unless you build memory on purpose. This talk covers the three memory layers we use at Latticework — scratchpad, episodic, and long-term profile — and when each one earns its storage cost.'
 || char(10) || char(10) ||
 'TODO before submitting: tighten the outline once the memory-ablation eval numbers land, and decide whether the profile-decay demo is live or recorded.'
 WHERE id = 's_draft' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Last year we went from one internal assistant to about 4,000 agent runs a day, and almost nothing that broke was the model. This session is a tour of the boring infrastructure that made the fleet dependable: work queues with per-tenant fairness, checkpointing so a five-minute run does not restart from zero, and blast-radius isolation so one misbehaving prompt cannot brown-out the cluster.'
 || char(10) || char(10) ||
 'We will walk through three production incidents in detail — a retry storm that 10x-ed our token bill overnight, a tool-call loop that filled a queue with poison messages, and a silent regression that only showed up in week-over-week eval drift.'
 || char(10) || char(10) ||
 'You will leave with the checklist we now apply before any agent workload ships, and the graphs we wish we had built first.'
 WHERE id = 's_pending' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Most agent demos die in the gap between a cherry-picked transcript and a Tuesday-afternoon user. Eighteen months ago we started refusing to build any agent behavior we could not first express as an eval, and it quietly restructured how the whole team works.'
 || char(10) || char(10) ||
 'This talk shows the mechanics: a 400-scenario suite distilled from support tickets, LLM judges we actually trust (and the two we retired for grading their own homework), and regression gates wired into CI so a prompt edit cannot ship on vibes.'
 || char(10) || char(10) ||
 'Expect concrete artifacts — our scenario schema, judge prompts, and the dashboard that ended the weekly "did it get worse" argument.'
 WHERE id = 's_acceptq' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Retrieval went from research afterthought to the load-bearing wall of production AI, and most of what made it work for us was not in any paper. This keynote traces one retrieval stack over three years: naive vector search, the hybrid rebuild, the reranker that finally moved the metric, and the freshness pipeline that kept answers true after the docs changed.'
 || char(10) || char(10) ||
 'Along the way: why our biggest quality win was a boring metadata filter, how we caught embedding drift with a $40-a-month canary suite, and what we measure now that recall stopped being the bottleneck.'
 || char(10) || char(10) ||
 'If you are building on retrieval in 2026, this is the map of the potholes.'
 WHERE id = 's_accepted' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Shipping an agent inside a 40,000-person company is a different sport from shipping one to developers. The blockers are rarely technical: procurement wants a vendor risk review, security wants an audit trail for every tool call, and legal wants to know exactly which data the model saw and when.'
 || char(10) || char(10) ||
 'This session covers the patterns that got three agent deployments through those gates — permission-scoped tool inventories, human-approval checkpoints that do not destroy latency budgets, and audit logs designed for the auditor rather than the engineer.'
 || char(10) || char(10) ||
 'Case material comes from finance and healthcare deployments, with the redacted artifacts we used in the actual reviews.'
 WHERE id = 's_accepted2' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'In this session I will present OrbitOps, our end-to-end enterprise AI orchestration suite. OrbitOps unifies prompt management, agent deployment, observability, and governance in a single pane of glass, powered by our proprietary AutoTune engine.'
 || char(10) || char(10) ||
 'I will demonstrate our drag-and-drop workflow builder, walk through customer success stories including a Fortune 500 rollout, and share our product roadmap for the coming year, including the new Teams tier.'
 || char(10) || char(10) ||
 'Attendees receive an extended trial license and a discount code for annual plans.'
 WHERE id = 's_declineq' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Every hype cycle ends, and engineering organizations are left holding whatever they hired and promised at the peak. This talk is a field guide to running a team through the descent: how to sunset the projects that existed because of the cycle rather than the customers, and how to keep the people who joined for the wrong reasons but stayed for the right ones.'
 || char(10) || char(10) ||
 'Drawn from two downturns of management experience across companies from 20 to 2,000 engineers.'
 WHERE id = 's_declined' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Feature flags started as a deploy safety net and grew into the way our whole product organization makes decisions. This talk covers the unglamorous middle period — the flag debt, the permanent "temporary" flags, the incident caused by a flag nobody owned — and the lifecycle discipline that got us out of it.'
 || char(10) || char(10) ||
 'Includes the cleanup playbook we now run quarterly and the ownership model that keeps stale flags from accumulating again.'
 WHERE id = 's_withdrawn' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'AI engineering stopped being a frontier discipline and started being a job description — but the tools, the org charts, and the failure modes are still catching up. This opening keynote takes stock of where production teams actually are, drawing on conversations with more than a hundred teams over the past year.'
 || char(10) || char(10) ||
 'We will look at what quietly became standard (evals in CI, retrieval as infrastructure, structured output everywhere), what is still genuinely unsolved (memory, multi-step reliability, cost attribution), and where the next twelve months of leverage most likely sit.'
 || char(10) || char(10) ||
 'The goal is a shared map for the three days ahead — so the hallway arguments start from the same facts.'
 WHERE id = 's_open_keynote' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Four teams run open-weight models in production today, at four very different scales, and none of them made the same choices. This panel puts their engineering leads on one stage to compare notes for real: serving stacks, fine-tuning strategy, evals, and what the actual invoices look like.'
 || char(10) || char(10) ||
 'Expect specifics rather than positioning — which workloads moved to open weights and which moved back, where the operational burden really lands, and what each panelist would choose if they were starting today.'
 WHERE id = 's_open_models' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Prompt injection is no longer a party trick — it is a production security class with real incidents, and most mitigations teams reach for first do not survive contact with an attacker. This deep dive works through the attack taxonomy as it exists in the wild: direct injection, indirect injection through retrieved content, and tool-call hijacking through poisoned data.'
 || char(10) || char(10) ||
 'For each class we look at a real (anonymized) incident, then at the defenses that held and the ones that folded — spoiler: the ones that folded were mostly prompts asking the model to behave.'
 || char(10) || char(10) ||
 'You will leave with a layered defense checklist ordered by cost, and a test harness for probing your own app before someone else does.'
 WHERE id = 's_prompt_injection' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Bring a laptop, leave with a model. In 90 minutes we take a 3B-parameter open model from base weights to a fine-tune that beats a model ten times its size on one specific task — classifying and routing support conversations.'
 || char(10) || char(10) ||
 'The workshop covers the full loop: shaping a training set from raw tickets, LoRA fine-tuning in a hosted notebook we provide, evaluating against a held-out set so we know it actually worked, and exporting the result for local serving.'
 || char(10) || char(10) ||
 'No GPU required on your machine — notebooks are provisioned. Comfort with Python is assumed, prior fine-tuning experience is not.'
 WHERE id = 's_finetune_ws' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Vector search is a great first chapter and a terrible whole book. In production, the retrieval systems that hold up are hybrids: lexical search for precision, embeddings for recall, structured filters for correctness, and a reranker to arbitrate.'
 || char(10) || char(10) ||
 'This talk walks through the hybrid architecture we converged on after two rebuilds, with the eval data that drove each decision — including the query classes where embeddings alone quietly failed (exact identifiers, negations, and anything with a date).'
 || char(10) || char(10) ||
 'Practical throughout: schemas, query plans, and the 20-line fusion function doing most of the work.'
 WHERE id = 's_retrieval' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Our inference bill was on track to pass our payroll. This talk is the story of cutting tokens-per-dollar by 7x without a visible quality drop, in the order the savings actually arrived: response caching, prompt-prefix reuse, routing easy queries to small models, quantized self-hosting for the bulk tier, and renegotiating the long tail.'
 || char(10) || char(10) ||
 'Every technique comes with the eval evidence we used to prove "no visible quality drop" to a skeptical product team, plus the two optimizations we rolled back because the quality cost was real.'
 WHERE id = 's_budget_llms' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Evals are the highest-leverage infrastructure an AI team can own, and the tooling matters far less than the muscle. In this hands-on session we build an eval harness from an empty directory: golden sets, graders (exact, rubric, and LLM-judge), a runner with caching, and a CI gate that blocks regressions.'
 || char(10) || char(10) ||
 'We will use a real support-bot dataset with real ambiguity in it, because learning to handle "both answers are kind of right" is the actual skill.'
 || char(10) || char(10) ||
 'Bring a laptop with Python. You will leave with a working harness and, more usefully, opinions about what to measure.'
 WHERE id = 's_evals_ws' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'The console was never the product — it was the interim UI for infrastructure that could not yet describe itself. This keynote argues that the next platform shift is already visible at the edges: infrastructure declared next to application code, environments that assemble themselves, and agents as the first users of every API.'
 || char(10) || char(10) ||
 'We will trace the pattern through what shipped in the last two years, separate it from the vaporware, and ask what "developer experience" means when the developer stops clicking.'
 || char(10) || char(10) ||
 'Opinionated, occasionally wrong, and intended to start arguments that last all three days.'
 WHERE id = 's_postcloud' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Everyone in this industry is spending someone else''s margin. This panel brings together people who see the inference market from different seats — a capacity buyer at a scaled AI product, an economist covering compute markets, and an infrastructure lead who moved a workload across three providers in a year.'
 || char(10) || char(10) ||
 'On the table: where prices are actually heading, whether the current subsidy era ends with a whimper or a repricing, what moats survive commoditized inference, and how to write a capacity plan you will not regret in six months.'
 WHERE id = 's_inference_econ' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Three agents made it to production. One triages support tickets, one migrates legacy code, one runs infrastructure remediations. All three nearly died in month two, each for a different reason.'
 || char(10) || char(10) ||
 'This talk is the post-mortem series: the triage agent that optimized its way into deflecting tickets it should have escalated, the migration agent whose 92% success rate hid a catastrophic 8%, and the ops agent that learned to silence the alerts it caused.'
 || char(10) || char(10) ||
 'For each: the failure, the detection gap, the fix, and the metric we now watch. No composite anecdotes — these are our own systems.'
 WHERE id = 's_agents_ship' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'You cannot fix what you cannot see, and most LLM apps ship blind. This workshop builds the observability stack for an AI application from first principles: structured traces for every model call and tool invocation, cost and latency attribution per feature, and online evals that score a sample of production traffic continuously.'
 || char(10) || char(10) ||
 'We instrument a working agent app together, break it in controlled ways, and practice finding each failure in the traces before looking at the answer key.'
 || char(10) || char(10) ||
 'Laptop required, OpenTelemetry familiarity helpful but not assumed. You leave with the instrumented repo and the dashboards.'
 WHERE id = 's_llm_obs_ws' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Parsing model output with regexes is how you end up debugging production at midnight. Constrained decoding and schema-first output turned our flakiest integration surface into the most boring one, and this talk covers how to get there at scale.'
 || char(10) || char(10) ||
 'Topics: designing schemas the model can actually satisfy, retry ladders that repair rather than regenerate, validating semantics (not just syntax) before an output touches a downstream system, and the throughput cost of constrained decoding measured properly.'
 || char(10) || char(10) ||
 'Includes the failure-rate data from a year of migrating 30+ extraction pipelines to schema-first output.'
 WHERE id = 's_structured_out' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'The most reliable AI app is the one that keeps working in airplane mode. Local-first AI stopped being a curiosity when small models crossed the "good enough" line for summarization, classification, and retrieval over personal data — all workloads that never needed a datacenter round-trip in the first place.'
 || char(10) || char(10) ||
 'This talk covers the architecture patterns: on-device inference with server fallback, embedding sync that respects bandwidth and privacy, and the UX contract for "the smart features degrade gracefully offline."'
 || char(10) || char(10) ||
 'Demoed live on a laptop with the network off, because that is the whole point.'
 WHERE id = 's_localfirst' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Every platform team eventually faces the question: build the AI platform layer or buy it. Both answers are expensive and one of them is wrong for you specifically. This panel stages the argument properly, with a platform lead who built and regrets nothing, one who bought and regrets nothing, and one who did each and switched.'
 || char(10) || char(10) ||
 'The moderator will push past slogans toward the variables that actually decide it: team size, workload diversity, compliance surface, and how fast the vendor market is eating each layer of the homegrown stack.'
 WHERE id = 's_build_buy' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'The fastest and cheapest LLM call is the one you never make. But semantic caching — reusing an answer because the question is "close enough" — is a correctness gamble that has burned every team that treated it as a drop-in.'
 || char(10) || char(10) ||
 'This talk maps the caching ladder from safe to spicy: exact-match response caches, provider prompt-prefix caching, retrieval-layer caching, and full semantic caches with similarity thresholds. For each rung: the hit rates we measured, the invalidation strategy that keeps it honest, and the incident that taught us where the threshold belongs.'
 WHERE id = 's_llm_caching' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'The interesting documents were never plain text. Invoices, engineering drawings, medical forms, dashboards — the high-value pipelines are the ones that read pixels and text together, and they fail in ways pure-text systems never prepared us for.'
 || char(10) || char(10) ||
 'This session walks one production document pipeline end to end: layout-aware chunking, when vision models beat OCR (and the surprising cases where they still lose), grounding extraction against source regions so humans can verify, and evals for outputs where "mostly right" is not a number.'
 || char(10) || char(10) ||
 'Benchmarks come from 2M processed pages, with costs.'
 WHERE id = 's_multimodal' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Speakers meet your conference twice: once through the CFP form, once on stage. Most events lose great talks at the first meeting, and the data shows it — every additional required question measurably cuts submissions, and the cuts are not evenly distributed.'
 || char(10) || char(10) ||
 'This talk turns eight years of program-chair data into form design guidance: the question budget, what belongs at submission versus after acceptance, how draft-saving and deadline design change who finishes the form, and review transparency that keeps declined speakers coming back.'
 || char(10) || char(10) ||
 'You will leave with a CFP template and the evidence to defend it to your committee.'
 WHERE id = 's_cfp_design' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Three days, five tracks, and several hundred hallway arguments deserve a synthesis. The closing panel brings program voices and audience favorites back on stage to separate what we actually learned this week from what merely sounded good in a keynote.'
 || char(10) || char(10) ||
 'Structured as rapid rounds: the strongest claim heard all week, the prediction each panelist is willing to be graded on next year, and the tool each is actually adopting when they get home. Audience questions take the second half — bring the argument you did not get to finish.'
 WHERE id = 's_closing_panel' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'A conference program is a database with an audience, so treat it like one. In this workshop we ship a complete conference site in a day: program data in, a fast public site out — sessions catalog, speaker directory, schedule grid, and calendar feeds.'
 || char(10) || char(10) ||
 'We build from an empty repo on free-tier infrastructure, wire the program data through build-time generation plus a live API for the bits that change during the event, and finish with embeds the marketing site can drop in without redeploying.'
 || char(10) || char(10) ||
 'Bring a laptop with Node installed. Every attendee leaves with their own deployed site and the repo to keep.'
 WHERE id = 's_confsite_ws' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'The transformer has been the answer for eight years, which historically is when architectures stop being the answer. This talk surveys the challengers honestly: state-space models, hybrid attention schemes, and the sparse and recurrent revivals — what the benchmarks actually show once you control for training budget, and where each candidate wins on the merits today.'
 || char(10) || char(10) ||
 'The frame is practical: what should a production team do about any of this now, what signals would mean the answer changed, and which "post-transformer" claims are really just marketing for a fine-tune.'
 WHERE id = 's_post_transformer' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'SQLite at the edge changes what a migration even is: no maintenance window, no replica to fail over to, and a write path you share with live traffic. We have run 40+ schema migrations on D1 databases serving production requests, and this talk is the complete playbook.'
 || char(10) || char(10) ||
 'The core is expand-and-contract adapted for D1''s constraints: additive schema changes, dual-write windows, chunked backfills sized against statement limits, and verification queries that prove the cutover before the old column dies.'
 || char(10) || char(10) ||
 'Includes the migration that went wrong, what the failure looked like from the outside, and the guardrail that now prevents it.'
 WHERE id = 's_d1_migrations' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'The subscription wall was a billing model that grew into an architecture, and it is quietly coming apart. Teams are replacing rented software with open cores they can read, run, and modify — not for ideology, but because the economics finally flipped.'
 || char(10) || char(10) ||
 'This closing keynote maps the post-SaaS stack as it exists today: which categories flipped first and why, what actually happens to total cost when licenses go away and operations come home, and the failure stories from teams that self-hosted more than they could operate.'
 || char(10) || char(10) ||
 'It closes with a build-borrow-buy framework for the next decade — and one prediction the speaker is prepared to defend on stage.'
 WHERE id = 's_closing_keynote' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'No slides, just terminals. This is a live tour of a production agent swarm doing real work: a fleet of specialized agents coordinating on tasks with checkpoints, retries, and a shared control plane — running against live infrastructure on stage.'
 || char(10) || char(10) ||
 'We will watch the scheduler make (and reconsider) placement decisions, kill a worker mid-task to watch recovery happen, and inject a poisoned task to see containment hold. Then we read the traces of everything we just watched.'
 || char(10) || char(10) ||
 'If the demo gods frown, the failure analysis is the content — that is not a joke, it is the backup talk and it is arguably better.'
 WHERE id = 's_live_demo' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Bring your slow queries. This is an open working session, not a talk: we put real query plans from the audience on screen and fix them together — missing indexes, accidental full scans, pagination that degrades with offset, and the D1-specific costs that surprise teams arriving from client-server databases.'
 || char(10) || char(10) ||
 'Come with EXPLAIN QUERY PLAN output for your worst offender, or just come to watch two dozen plans get read out loud — most attendees report the pattern-recognition is the thing they take home.'
 WHERE id = 's_office_hours' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Open CFPs are democratic, slow, and increasingly gamed — the LLM-written submission wave hit every major conference this year. Pure curation is fast, biased, and books the same twelve speakers every circuit. Every program chair is quietly renegotiating this trade-off, and this panel drags the negotiation on stage.'
 || char(10) || char(10) ||
 'Three chairs with three very different models — fully open, fully curated, and hybrid — bring their actual numbers: submission volumes, acceptance rates, speaker-diversity outcomes, and audience scores. The argument is real and the data does not agree with anyone completely.'
 WHERE id = 's_panel_cfp' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'Your conference emails are landing in spam and nobody is telling you. Acceptance notices, schedule changes, day-of logistics — event email is bursty, link-heavy, and sent from domains that are cold eleven months a year, which is exactly the traffic pattern providers distrust.'
 || char(10) || char(10) ||
 'This hands-on workshop fixes it at the root: we set up SPF, DKIM, and DMARC on a real domain live, misconfigure each one to see the exact failure, then align a sending service and read the DMARC reports that tell you what the inbox providers actually saw.'
 || char(10) || char(10) ||
 'Bring a domain you control (a test domain is fine) and a laptop. DNS confidence not required — that is what we are here to build.'
 WHERE id = 's_workshop_email' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'We got SOC 2 Type II with two engineers, no compliance hire, and a tooling budget that embarrassed our auditor. This talk is the honest war story: what the framework actually requires versus what vendors imply it requires, which controls we automated versus wrote down and did by hand, and where we nearly failed the audit.'
 || char(10) || char(10) ||
 'Useful if compliance is on your roadmap and you are trying to budget it — in both dollars and morale. Includes our evidence-collection setup and the questions worth asking an auditor before signing.'
 WHERE id = 's_soc2' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');

UPDATE submissions SET description =
 'GPU pricing is a market with three-year contracts on one end, spot preemptions on the other, and very little honest guidance in between. This deep dive builds the mental model: what actually drives the spot market''s daily swings, when reserved capacity beats on-demand (the break-even math, worked live), and how the neocloud tier changes the calculus for training versus inference.'
 || char(10) || char(10) ||
 'Comes with a year of our own procurement data across four providers, anonymized but real, and the spreadsheet we use to decide where every workload runs.'
 WHERE id = 's_gpu_pricing' AND event_id = 'e_demo'
 AND EXISTS (SELECT 1 FROM events e WHERE e.id = submissions.event_id AND e.organization_id = 'org_demo');
