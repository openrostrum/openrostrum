import { and, asc, eq } from "drizzle-orm";
import { redirect } from "react-router";
import { getDb } from "~/db";
import {
	authSessions,
	events,
	organizationMembers,
	organizations,
	reviewerTracks,
	tracks,
	users,
} from "~/db/schema";

type AppRole = (typeof users.$inferSelect)["role"];

/**
 * Sentinel password hash for invited accounts (team members, speakers): the
 * user row exists for linking/invite purposes, but nothing can verify against
 * a non-PBKDF2 hash until the invitee sets a real password via
 * /set-password/:token. One prefix, shared by every invite flow — two
 * spellings of this convention would silently break invite-state detection.
 */
export const SENTINEL_HASH_PREFIX = "invite-pending$";

export function mintSentinelHash(): string {
	return `${SENTINEL_HASH_PREFIX}${crypto.randomUUID()}`;
}

/** True when the account holds a real password (not an invite sentinel). */
export function hasSetPassword(passwordHash: string): boolean {
	return passwordHash.startsWith("pbkdf2$");
}

/** Canonical email form — ALWAYS store/look up lowercased+trimmed so a cased
 * re-signup can't mint a duplicate identity (users.email is BINARY-unique). */
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/** Where each role lands after login (reviewers can't enter the admin shell). */
export function homePathForRole(role: AppRole): string {
	if (role === "admin") return "/admin";
	if (role === "reviewer") return "/reviews";
	return "/portal";
}

/** Same-origin internal path, or null if the target is external/unsafe
 * (blocks //host, /\host, scheme tricks) — the open-redirect guard for every
 * user-supplied redirectTo. Callers fall back to their own default. */
export function safeRedirect(requested: string): string | null {
	if (!requested.startsWith("/")) return null;
	const resolved = new URL(requested, "http://sentinel.invalid");
	return resolved.origin === "http://sentinel.invalid"
		? resolved.pathname + resolved.search + resolved.hash
		: null;
}

/**
 * Password hashing runs on WebCrypto PBKDF2 (bcrypt does not run in workerd).
 * Sessions are server-side rows in `auth_sessions`; the cookie holds only an
 * opaque session id, so nothing sensitive lives client-side and logout is a
 * single DELETE.
 */

const COOKIE = "__session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
// The Workers runtime hard-caps PBKDF2 deriveBits at 100k iterations in
// production (local workerd doesn't enforce it — logins 500 only when
// deployed, verified live 2026-08-10). 100k is therefore the ceiling here.
const PBKDF2_ITERATIONS = 100_000;

type AppUser = typeof users.$inferSelect;

/* -------------------------------------------------------------- passwords --- */

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function pbkdf2(
	password: string,
	salt: Uint8Array,
	iterations: number,
): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt: salt as unknown as BufferSource,
			iterations,
			hash: "SHA-256",
		},
		key,
		256,
	);
	return new Uint8Array(bits);
}

/** Returns `pbkdf2$<iterations>$<saltB64>$<hashB64>`. */
export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
	return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/**
 * Constant-time-ish comparison of a candidate password against a stored hash.
 * Uses the iteration count EMBEDDED in the hash, so raising PBKDF2_ITERATIONS
 * (or importing hashes made at a different count) never invalidates old
 * passwords — new logins just re-hash at the current count.
 */
export async function verifyPassword(
	password: string,
	stored: string,
): Promise<boolean> {
	const [scheme, iterStr, saltB64, hashB64] = stored.split("$");
	if (scheme !== "pbkdf2" || !saltB64 || !hashB64) return false;
	const iterations = Number(iterStr);
	if (!Number.isInteger(iterations) || iterations <= 0) return false;
	const salt = fromBase64(saltB64);
	const expected = fromBase64(hashB64);
	const actual = await pbkdf2(password, salt, iterations);
	if (actual.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < actual.length; i += 1)
		diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
	return diff === 0;
}

// A valid hash at the CURRENT iteration count, used only to equalize timing
// when the email doesn't exist. It must stay at PBKDF2_ITERATIONS: a dummy
// minted at a higher count than the Workers runtime cap would make the
// unknown-email path THROW in production instead of returning false.
const TIMING_DUMMY_HASH =
	"pbkdf2$100000$aSqRq0XCE+U62GUmG1OUqg==$7007E8kKOtwNCfhBs3QTdUh/aS1iJwcjCfU//25YYjU=";

/**
 * Login-path verify that costs the same whether or not the account exists, so
 * response timing can't reveal account existence. Pass the stored hash when
 * the user row was found, undefined when it wasn't.
 */
export async function verifyPasswordTimingEqual(
	password: string,
	stored: string | null | undefined,
): Promise<boolean> {
	const ok = await verifyPassword(password, stored ?? TIMING_DUMMY_HASH);
	return stored != null && ok;
}

/* --------------------------------------------------------------- sessions --- */

/** True over HTTPS (prod) — false on local `http://` dev, where `Secure` would
 * make the browser silently drop the cookie (Safari, LAN hosts). */
export function isSecureRequest(request: Request): boolean {
	return new URL(request.url).protocol === "https:";
}

function cookieHeader(
	value: string,
	maxAgeSeconds: number,
	secure: boolean,
): string {
	const attrs = [
		`${COOKIE}=${value}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${maxAgeSeconds}`,
	];
	if (secure) attrs.push("Secure");
	return attrs.join("; ");
}

function readCookie(request: Request): string | null {
	const header = request.headers.get("Cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name === COOKIE) return rest.join("=");
	}
	return null;
}

/**
 * Create a session row and return the `Set-Cookie` header value. Pass `secure`
 * from `isSecureRequest(request)` so the cookie isn't dropped on local http dev.
 */
export async function createSession(
	env: Env,
	userId: string,
	secure = true,
): Promise<string> {
	const db = getDb(env);
	const sessionId = crypto.randomUUID();
	await db.insert(authSessions).values({
		id: sessionId,
		userId,
		expiresAt: new Date(Date.now() + SESSION_TTL_MS),
	});
	return cookieHeader(sessionId, Math.floor(SESSION_TTL_MS / 1000), secure);
}

/** Delete the current session (if any) and return a clearing `Set-Cookie`. */
export async function destroySession(
	env: Env,
	request: Request,
): Promise<string> {
	const sessionId = readCookie(request);
	if (sessionId) {
		await getDb(env).delete(authSessions).where(eq(authSessions.id, sessionId));
	}
	return cookieHeader("", 0, isSecureRequest(request));
}

/** Resolve the logged-in user from the request cookie, or null. */
export async function getUser(
	env: Env,
	request: Request,
): Promise<AppUser | null> {
	const sessionId = readCookie(request);
	if (!sessionId) return null;
	const db = getDb(env);
	const [row] = await db
		.select({ user: users, expiresAt: authSessions.expiresAt })
		.from(authSessions)
		.innerJoin(users, eq(users.id, authSessions.userId))
		.where(eq(authSessions.id, sessionId))
		.limit(1);
	// Unknown id (e.g. a garbage/forged cookie) → no DB write, so random cookies
	// can't cause write-amplification.
	if (!row) return null;
	if (row.expiresAt.getTime() <= Date.now()) {
		// Prune only a genuinely-expired session we actually hold.
		await db.delete(authSessions).where(eq(authSessions.id, sessionId));
		return null;
	}
	return row.user;
}

/**
 * Require a logged-in user, optionally with one of `roles`. Throws a redirect
 * (to /login, or /403 on role mismatch) — call at the top of a loader/action.
 */
export async function requireUser(
	env: Env,
	request: Request,
	roles?: ReadonlyArray<AppUser["role"]>,
): Promise<AppUser> {
	const user = await getUser(env, request);
	if (!user) {
		const url = new URL(request.url);
		throw redirect(`/login?redirectTo=${encodeURIComponent(url.pathname)}`);
	}
	if (roles && !roles.includes(user.role)) throw redirect("/403");
	return user;
}

/** Require a logged-in user with one of `roles` (shared helper — don't reinvent). */
export function requireRole(
	env: Env,
	request: Request,
	...roles: ReadonlyArray<AppUser["role"]>
): Promise<AppUser> {
	return requireUser(env, request, roles);
}

/** Require a logged-in admin. */
export function requireAdmin(env: Env, request: Request): Promise<AppUser> {
	return requireUser(env, request, ["admin"]);
}

/** Events joined to the caller's org memberships — the ONE access predicate
 * for admin event resolution (event → org → member). */
function memberEvents(db: ReturnType<typeof getDb>, userId: string) {
	return db
		.select({ event: events })
		.from(events)
		.innerJoin(
			organizationMembers,
			and(
				eq(organizationMembers.organizationId, events.organizationId),
				eq(organizationMembers.userId, userId),
			),
		);
}

/**
 * The "current event" an admin operates on — `users.activeEventId` when it
 * points at an event of an org the user belongs to, else the first event
 * across the user's orgs. NEVER hardcode `findMany({limit:1})` in a feature —
 * call this so the event switcher works. A stale/forged `activeEventId`
 * (another org's event) is ignored, never served. Returns null when the user
 * has no org with an event — membership-less users (reviewers resolve via
 * `getReviewerEventIds`) and brand-new organizers (send them to /onboarding);
 * consumers must render an empty state or redirect, never assume non-null.
 */
export async function getActiveEvent(
	env: Env,
	user: AppUser,
): Promise<typeof events.$inferSelect | null> {
	const db = getDb(env);
	if (user.activeEventId) {
		const [row] = await memberEvents(db, user.id)
			.where(eq(events.id, user.activeEventId))
			.limit(1);
		if (row) return row.event;
	}
	const [first] = await memberEvents(db, user.id)
		.orderBy(asc(events.createdAt), asc(events.id))
		.limit(1);
	return first?.event ?? null;
}

/** Every event the user may operate on — their orgs' events only (the event
 * switcher's listing; another org's events must never appear here). */
export async function listMyEvents(
	env: Env,
	userId: string,
): Promise<Array<typeof events.$inferSelect>> {
	const rows = await memberEvents(getDb(env), userId).orderBy(
		asc(events.createdAt),
		asc(events.id),
	);
	return rows.map((r) => r.event);
}

/** Membership check for one event (event → org → member) — the row-level
 * guard for writes/reads that target an explicit eventId. */
export async function userCanAccessEvent(
	env: Env,
	userId: string,
	eventId: string,
): Promise<boolean> {
	const [row] = await memberEvents(getDb(env), userId)
		.where(eq(events.id, eventId))
		.limit(1);
	return row !== undefined;
}

/**
 * Event scope for reviewers. Reviewers hold NO organization membership
 * (a membership row would make them org admins) — their events derive from
 * track assignments: reviewer_tracks → tracks.event_id. Reviewer surfaces
 * resolve through this, never through getActiveEvent (null for them).
 */
export async function getReviewerEventIds(
	env: Env,
	userId: string,
): Promise<string[]> {
	const rows = await getDb(env)
		.selectDistinct({ eventId: tracks.eventId })
		.from(reviewerTracks)
		.innerJoin(tracks, eq(tracks.id, reviewerTracks.trackId))
		.where(eq(reviewerTracks.userId, userId));
	return rows.map((r) => r.eventId);
}

/**
 * The organization the caller operates on: the active event's org when one is
 * set (getActiveEvent only returns the caller's orgs' events), else their
 * first membership (an org can predate its first event). Null = no org.
 * admin.settings.team + admin.events.new carry older inline copies of this
 * resolution — converging them here is an integration-sweep item.
 */
export async function resolveActiveOrg(
	env: Env,
	user: AppUser,
): Promise<typeof organizations.$inferSelect | null> {
	const db = getDb(env);
	const event = await getActiveEvent(env, user);
	if (event) {
		const [org] = await db
			.select()
			.from(organizations)
			.where(eq(organizations.id, event.organizationId))
			.limit(1);
		if (org) return org;
	}
	const [first] = await db
		.select({ org: organizations })
		.from(organizationMembers)
		.innerJoin(
			organizations,
			eq(organizations.id, organizationMembers.organizationId),
		)
		.where(eq(organizationMembers.userId, user.id))
		.orderBy(asc(organizationMembers.createdAt))
		.limit(1);
	return first?.org ?? null;
}
