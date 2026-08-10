import { Hono } from "hono";
import { authenticateApiToken, resolveApiTokenEvent } from "~/lib/api-token";
import { errorMessage } from "~/lib/errors";
import { track } from "~/lib/track";
import { ApiError, type ApiHonoEnv } from "./context";
import { registerContactRoutes } from "./contacts";
import { registerEventRoutes } from "./events";
import { registerLookupRoutes } from "./lookups";
import { registerSessionRoutes } from "./sessions";

/**
 * The Sessionboard-compatible read API (`/api/v1/*`) — the migration story
 * for teams with existing API integrations. Auth is the org-scoped
 * `x-access-token` guard; every event read resolves through the token's
 * readable set with existence-hiding 404s; serializers hardcode Hide-PII ON.
 * Write operations stay out by design — the envelope is the feature.
 */
export const apiV1 = new Hono<ApiHonoEnv>().basePath("/api/v1");

apiV1.onError((error, c) => {
	if (error instanceof ApiError) {
		return c.json({ error: error.code, message: error.message }, error.status);
	}
	track("api.request_failed", {
		method: c.req.method,
		path: new URL(c.req.url).pathname,
		error: errorMessage(error),
	});
	return c.json(
		{ error: "internal_error", message: "Something went wrong." },
		500,
	);
});

apiV1.notFound((c) =>
	c.json({ error: "not_found", message: "Not found" }, 404),
);

// Request log + total timing. Registered first so it wraps auth failures too.
apiV1.use("*", async (c, next) => {
	const start = performance.now();
	await next();
	const dur = performance.now() - start;
	c.res.headers.set("Server-Timing", `total;dur=${dur.toFixed(1)}`);
	const principal = c.get("principal") as
		| ApiHonoEnv["Variables"]["principal"]
		| undefined;
	track("api.request", {
		method: c.req.method,
		path: new URL(c.req.url).pathname,
		status: c.res.status,
		tokenId: principal?.id ?? null,
		dur: Math.round(dur),
	});
});

// Token auth on every path — including unknown ones, so the surface leaks
// nothing without credentials. lastUsedAt stamps off the critical path when
// an ExecutionContext exists (it always does on Workers; tests may omit it).
apiV1.use("*", async (c, next) => {
	const raw = c.req.header("x-access-token");
	if (!raw) {
		throw new ApiError(
			401,
			"unauthorized",
			"Missing x-access-token header. Generate a token under Settings → API tokens.",
		);
	}
	let waitUntil: ((promise: Promise<unknown>) => void) | undefined;
	try {
		const executionCtx = c.executionCtx;
		waitUntil = (promise) => executionCtx.waitUntil(promise);
	} catch {
		waitUntil = undefined;
	}
	const principal = await authenticateApiToken(c.env, raw, waitUntil);
	if (!principal) {
		throw new ApiError(401, "unauthorized", "Invalid API token.");
	}
	c.set("principal", principal);
	await next();
});

// Read-only surface: authenticated write attempts get an explicit 405, never
// a silent 404 that reads as "wrong URL".
const READ_ONLY_MESSAGE =
	"The OpenRostrum API is read-only; write operations are not supported.";
apiV1.use("*", async (c, next) => {
	const method = c.req.method;
	const isWriteMethod =
		method === "PUT" || method === "PATCH" || method === "DELETE";
	// Sessionboard spells creation as POST with a /create|/bulk|/restore suffix.
	const isWritePost =
		method === "POST" &&
		/\/(create|bulk|restore)$/.test(new URL(c.req.url).pathname);
	if (isWriteMethod || isWritePost) {
		throw new ApiError(405, "method_not_allowed", READ_ONLY_MESSAGE);
	}
	await next();
});

// Every event-scoped read resolves the event inside the token's readable set
// (org + optional per-token restriction). Outside it — other org, restricted
// away, or nonexistent — is the same 404: existence-hiding, never empty-200.
apiV1.use("/event/:eventId/*", async (c, next) => {
	const event = await resolveApiTokenEvent(
		c.env,
		c.get("principal"),
		c.req.param("eventId") ?? "",
	);
	if (!event) throw new ApiError(404, "not_found", "Event not found");
	c.set("event", event);
	await next();
});

registerEventRoutes(apiV1);
registerSessionRoutes(apiV1);
registerContactRoutes(apiV1);
registerLookupRoutes(apiV1);
