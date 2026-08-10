// Labeled gold set for the DeepSeek reviewer. Each case is a small changed-file
// snippet with the EXACT set of doctrine violations it contains (empty = clean).
// Grounded in real OpenRostrum patterns; the clean cases are deliberate traps
// (legit WHY comments, real tests, sanctioned throws/compat boundaries) that a
// noisy reviewer over-flags — they are how we measure false positives.
//
// Categories: bs-comment | weak-test | shortcut | legacy-shim

export const cases = [
	// ---- bs-comment: violations ----
	{
		id: "bs-restates-name",
		file: "app/lib/retry.ts",
		code: `// increment the retry counter
export function incrementRetryCounter(state) {
	state.retries += 1;
	return state;
}`,
		violations: ["bs-comment"],
	},
	{
		id: "bs-change-narration",
		file: "app/config.ts",
		code: `// was P2, promoted to core in the Aug refactor
export const MAX_UPLOAD_MB = 25;`,
		violations: ["bs-comment"],
	},
	{
		id: "bs-tier-citation",
		file: "app/lib/speakers.ts",
		code: `// implements SCOPE P1 #16 (public widgets), see eval-crosswalk EMB-04
export function loadSpeakers(db, eventId) {
	return db.select().from(contacts).where(eq(contacts.eventId, eventId));
}`,
		violations: ["bs-comment"],
	},
	{
		id: "bs-justification-prose",
		file: "app/marketing/mocks.tsx",
		code: `// Faithful, static renderings of the real product surfaces, built from the
// same tokens the live app uses, so the marketing page shows the actual thing
// and not a stylized impression.
export function SubmissionsMock() {
	return <div className="rounded-card border border-hair bg-surface" />;
}`,
		violations: ["bs-comment"],
	},

	// ---- bs-comment: clean traps ----
	{
		id: "ok-constraint-why",
		file: "app/lib/auth.ts",
		code: `// Cloudflare Workers hard-caps PBKDF2 at 100k iterations; a higher value
// throws only in production (workerd does not enforce it locally).
const PBKDF2_ITERATIONS = 100_000;`,
		violations: [],
	},
	{
		id: "ok-platform-why",
		file: "app/db/write.ts",
		code: `// D1 has no interactive transactions, so batch() is the only atomic multi-write.
await db.batch([insertUser, insertProfile]);`,
		violations: [],
	},
	{
		id: "ok-security-why",
		file: "app/routes/admin.submissions.tsx",
		code: `// Server-derive the tenant; never trust a client-supplied eventId.
const eventId = (await getActiveEvent(env, user)).id;`,
		violations: [],
	},
	{
		id: "ok-no-comment",
		file: "app/lib/name.ts",
		code: `export function fullName(contact) {
	return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}`,
		violations: [],
	},

	// ---- weak-test: violations ----
	{
		id: "weak-mock-theater",
		file: "test/notify.test.ts",
		code: `it("sends the email", async () => {
	const send = vi.fn();
	await notify({ send }, { to: "a@b.com" });
	expect(send).toHaveBeenCalledWith({ to: "a@b.com" });
});`,
		violations: ["weak-test"],
	},
	{
		id: "weak-rederived-oracle",
		file: "test/total.test.ts",
		code: `it("computes the total", () => {
	const items = [{ price: 3 }, { price: 4 }];
	const expected = items.reduce((s, i) => s + i.price, 0);
	expect(sumPrices(items)).toBe(expected);
});`,
		violations: ["weak-test"],
	},
	{
		id: "weak-copy-literal",
		file: "test/copy.test.ts",
		code: `import { WELCOME_COPY } from "../app/copy";
it("has welcome copy", () => {
	expect(WELCOME_COPY).toContain("Welcome to the call for speakers");
});`,
		violations: ["weak-test"],
	},
	{
		id: "weak-snapshot",
		file: "test/panel.test.ts",
		code: `it("renders the panel", () => {
	expect(render(Panel()).container.innerHTML).toMatchSnapshot();
});`,
		violations: ["weak-test"],
	},

	// ---- weak-test: clean traps ----
	{
		id: "ok-real-regression-test",
		file: "test/contacts.test.ts",
		code: `it("rejects a duplicate email in the same event", async () => {
	await addContact(db, { eventId, email: "a@b.com" });
	await expect(addContact(db, { eventId, email: "a@b.com" })).rejects.toThrow(/unique/);
	const rows = await db.select().from(contacts).where(eq(contacts.eventId, eventId));
	expect(rows).toHaveLength(1);
});`,
		violations: [],
	},
	{
		id: "ok-load-bearing-negative",
		file: "test/authz.test.ts",
		code: `it("403s a non-admin and never writes", async () => {
	const res = await action(reqAs(reviewer));
	expect(res.status).toBe(403);
	const rows = await db.select().from(submissions);
	expect(rows).toHaveLength(0);
});`,
		violations: [],
	},

	// ---- shortcut: violations ----
	{
		id: "shortcut-todo-unbounded",
		file: "app/lib/submissions.ts",
		code: `// TODO: paginate this once we have real data
export async function allSubmissions(db) {
	return db.select().from(submissions);
}`,
		violations: ["shortcut"],
	},
	{
		id: "shortcut-hardcoded-id",
		file: "app/lib/event.ts",
		code: `export async function currentEvent(db) {
	// for now just grab the seeded event
	return db.query.events.findFirst({ where: eq(events.id, "evt_demo_123") });
}`,
		violations: ["shortcut"],
	},
	{
		id: "shortcut-swallowed-error",
		file: "app/ports/airtable.ts",
		code: `export async function syncAirtable(env, record) {
	try {
		await pushToAirtable(env, record);
	} catch {
		// ignore
	}
}`,
		violations: ["shortcut"],
	},
	{
		id: "shortcut-noop-validation",
		file: "app/lib/validate.ts",
		code: `export function validate(input) {
	// v0, skip validation for now, revisit later
	return true;
}`,
		violations: ["shortcut"],
	},

	// ---- shortcut: clean traps ----
	{
		id: "ok-sanctioned-throw",
		file: "app/ports/airtable.ts",
		code: `export function createAirtableSync(env) {
	if (!env.AIRTABLE_API_KEY) {
		throw new Error("AIRTABLE_API_KEY is not configured; set it to enable sync.");
	}
	return new AirtableSync(env);
}`,
		violations: [],
	},
	{
		id: "ok-bounded-logged",
		file: "app/lib/recent.ts",
		code: `export async function recentSubmissions(db, eventId) {
	const rows = await db.select().from(submissions)
		.where(eq(submissions.eventId, eventId)).limit(50);
	if (rows.length === 50) log("recentSubmissions truncated at 50");
	return rows;
}`,
		violations: [],
	},

	// ---- legacy-shim: violations ----
	{
		id: "legacy-deprecated-alias",
		file: "app/ports/email.ts",
		code: `export { EmailSender } from "./sender";
/** @deprecated use EmailSender */
export { EmailSender as Mailer } from "./sender";`,
		violations: ["legacy-shim"],
	},
	{
		id: "legacy-dual-format-reader",
		file: "app/lib/status.ts",
		code: `export function readStatus(row) {
	return typeof row.status === "string"
		? row.status
		: (row.status?.value ?? "pending");
}`,
		violations: ["legacy-shim"],
	},
	{
		id: "legacy-parallel-v2",
		file: "app/lib/serialize.ts",
		code: `export function serializeSession(s) { return { id: s.id, title: s.title }; }
export function serializeSessionV2(s) { return { id: s.id, title: s.title, track: s.track }; }`,
		violations: ["legacy-shim"],
	},

	// ---- legacy-shim: clean traps (sanctioned compat boundaries) ----
	{
		id: "ok-api-v1-boundary",
		file: "app/routes/api.v1.sessions.ts",
		code: `// The /api/v1 envelope is Sessionboard-compatible on purpose (owner-decided
// feature): default page size 25, max 100.
export function apiEnvelope(rows, page) {
	return { data: rows, page, pageSize: 25 };
}`,
		violations: [],
	},
	{
		id: "ok-ics-stable-uid",
		file: "app/lib/ics.ts",
		code: `// Stable UID per session so calendar clients update the event in place
// instead of creating a duplicate on reschedule.
event.uid = "session-" + session.id + "@openrostrum.com";`,
		violations: [],
	},

	// ---- mixed + clean ----
	{
		id: "mixed-bs-and-shortcut",
		file: "app/lib/user.ts",
		code: `// helper to get the user
export async function getUser(db, id) {
	// TODO: cache this later
	return db.query.users.findFirst({ where: eq(users.id, id) });
}`,
		violations: ["bs-comment", "shortcut"],
	},
	{
		id: "ok-documented-fallback",
		file: "app/ports/turnstile.ts",
		code: `// Turnstile is a no-op in the judged deploy: the eval harness cannot solve a
// real challenge, so live bot protection would zero the speaker-path coverage.
export function verifyTurnstile(env, token) {
	if (!env.TURNSTILE_SECRET) return { ok: true, skipped: true };
	return callTurnstile(env.TURNSTILE_SECRET, token);
}`,
		violations: [],
	},
];
