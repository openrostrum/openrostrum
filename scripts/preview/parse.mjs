const WORKERS_DEV =
	/https:\/\/openrostrum-pr-\d+(?:\.[a-z0-9-]+)?\.workers\.dev\b/i;
const D1_UUID =
	/database_id\s*=\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i;

export function parseWorkersDevUrl(text) {
	return String(text).match(WORKERS_DEV)?.[0] ?? null;
}

export function parseCreatedDatabaseId(text) {
	return String(text).match(D1_UUID)?.[1] ?? null;
}

export function shouldSkipFork({ head, base }) {
	if (!head) return false;
	return head !== base;
}

export function classifyWranglerError(text) {
	const body = String(text);
	if (
		/Authentication error|code:\s*10000|not authorized|Unauthorized|forbidden|insufficient permissions|code:\s*10026|does not have permission/i.test(
			body,
		)
	) {
		return "token";
	}
	return "other";
}
