import { safeRedirect } from "~/lib/auth";

/**
 * Admin collection screens that exist for every event. A switch keeps the
 * organizer on these; a record URL still carries the previous event's id and
 * would 404, so those collapse to the parent collection.
 */
const EVENT_SCOPED_ADMIN_PAGES: Record<string, true> = {
	"/admin": true,
	"/admin/submissions": true,
	"/admin/abstracts": true,
	"/admin/sessions": true,
	"/admin/forms": true,
	"/admin/evaluation": true,
	"/admin/agenda": true,
	"/admin/tasks": true,
	"/admin/emails": true,
	"/admin/emails/history": true,
	"/admin/settings": true,
	"/admin/settings/library": true,
	"/admin/settings/team": true,
	"/admin/settings/api": true,
	"/admin/settings/airtable": true,
	"/admin/portals": true,
	"/admin/portal-forms": true,
	"/admin/reviewers": true,
	"/admin/files": true,
	"/admin/contacts": true,
	"/admin/contacts/import": true,
	"/admin/contacts/compose": true,
	"/admin/embeds": true,
	"/admin/crm": true,
	"/admin/crm/directory": true,
	"/admin/crm/directory/import": true,
	"/admin/crm/pipeline": true,
	"/admin/crm/segments": true,
	"/admin/crm/fields": true,
};

/** Same-origin admin path to land on after flipping the active event. */
export function stayAfterSwitch(requested: string): string {
	const safe = safeRedirect(requested);
	if (!safe) return "/admin";
	const resolved = new URL(safe, "http://sentinel.invalid");
	let path = resolved.pathname;
	while (path && path !== "/") {
		if (EVENT_SCOPED_ADMIN_PAGES[path]) {
			return path === resolved.pathname
				? path + resolved.search + resolved.hash
				: path;
		}
		const slash = path.lastIndexOf("/");
		path = slash <= 0 ? "" : path.slice(0, slash);
	}
	return "/admin";
}
