UPDATE events
SET starts_at = unixepoch('2026-10-12 15:00:00'),
	ends_at = unixepoch('2026-10-15 01:00:00')
WHERE id = 'e_demo'
	AND timezone = 'America/Los_Angeles'
	AND starts_at = unixepoch('2026-10-12')
	AND ends_at = unixepoch('2026-10-14');
