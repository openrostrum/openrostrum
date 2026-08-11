import { env } from "cloudflare:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	createMemoryRouter,
	RouterProvider,
	type ActionFunction,
} from "react-router";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "../app/db";
import { events, organizations, submissions, users } from "../app/db/schema";
import { hashPassword, verifyPassword } from "../app/lib/auth";
import { loader as submissionsLoader } from "../app/routes/admin.submissions";
import Signup, { action } from "../app/routes/signup";

const CONTEXT = { cloudflare: { env, ctx: {} } };

function post(body: Record<string, string>): Request {
	return new Request("http://localhost/signup", {
		method: "POST",
		body: new URLSearchParams(body),
	});
}

function act(body: Record<string, string>) {
	return action({
		context: CONTEXT,
		request: post(body),
		params: {},
	} as unknown as Parameters<typeof action>[0]);
}

function renderSignup(
	actionData?: Parameters<typeof Signup>[0]["actionData"],
	routeAction?: ActionFunction,
) {
	const router = createMemoryRouter(
		[
			{
				path: "/signup",
				element: createElement(Signup, {
					loaderData: { turnstileSiteKey: null },
					actionData,
				} as Parameters<typeof Signup>[0]),
				action: routeAction,
			},
		],
		{ initialEntries: ["/signup"] },
	);
	return {
		router,
		html: () => renderToStaticMarkup(createElement(RouterProvider, { router })),
	};
}

describe("signup route", () => {
	it("shows an explicit pending state while account creation is in flight", async () => {
		let finishAction: (() => void) | undefined;
		const pendingAction = new Promise<Response>((resolve) => {
			finishAction = () => resolve(new Response(null, { status: 204 }));
		});
		const { router, html } = renderSignup(undefined, () => pendingAction);

		const navigation = router.navigate("/signup", {
			formMethod: "post",
			formData: new FormData(),
		});
		await vi.waitFor(() => {
			expect(router.state.navigation.state).toBe("submitting");
		});

		const pendingHtml = html();
		expect(pendingHtml).toContain("disabled");
		expect(pendingHtml).toContain('aria-busy="true"');

		finishAction?.();
		await navigation;
	});

	it("announces the duplicate-email outcome as a specific inline error", () => {
		const { html } = renderSignup({
			existingAccount: true,
			values: { name: "Ada Again", email: "ada@example.com" },
		});

		const duplicateHtml = html();
		expect(duplicateHtml).toContain('role="alert"');
		expect(duplicateHtml).toContain('href="/login"');
	});

	it("creates an admin account, normalizes the email, and redirects to onboarding", async () => {
		const res = (await act({
			name: "Ada Lovelace",
			email: " Ada@Example.COM ",
			password: "correct-horse-9",
		})) as Response;

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/onboarding");
		expect(res.headers.get("Set-Cookie")).toContain("__session=");

		const rows = await getDb(env).select().from(users);
		expect(rows).toHaveLength(1);
		const user = rows[0];
		expect(user?.email).toBe("ada@example.com"); // cased signup can't mint a duplicate identity
		expect(user?.role).toBe("admin");
		expect(user?.name).toBe("Ada Lovelace");
		// The stored hash must verify the submitted password — the account can log in.
		expect(
			await verifyPassword("correct-horse-9", user?.passwordHash ?? ""),
		).toBe(true);
	});

	it("steers an existing email to sign-in — a message, never an error page", async () => {
		await getDb(env)
			.insert(users)
			.values({
				id: "u1",
				email: "ada@example.com",
				passwordHash: await hashPassword("secret-123"),
				role: "admin",
			});

		const result = await act({
			name: "Ada Again",
			email: "ADA@example.com", // different casing must hit the same account
			password: "another-pass-9",
		});

		expect(result).not.toBeInstanceOf(Response); // no redirect, no throw — an inline message
		expect(result).toHaveProperty("existingAccount", true);

		const rows = await getDb(env).select().from(users);
		expect(rows).toHaveLength(1); // no duplicate account minted
	});

	it("a fresh sign-up who skips onboarding never sees another org's data", async () => {
		// The pre-existing tenant (the deployed Demo org) with real data.
		const db = getDb(env);
		await db.insert(organizations).values({ id: "org_demo", name: "Demo" });
		await db.insert(events).values({
			id: "e_demo",
			organizationId: "org_demo",
			name: "Sandbox Event",
			slug: "sandbox",
		});
		await db.insert(submissions).values({
			id: "s_demo",
			eventId: "e_demo",
			title: "Demo talk",
		});

		const res = (await act({
			name: "Drive-by Admin",
			email: "driveby@example.com",
			password: "long-enough-9",
		})) as Response;
		const cookie = res.headers.get("Set-Cookie")?.split(";")[0] ?? "";

		// Straight to an admin surface WITHOUT onboarding: the loader must not
		// resolve the Demo event for a membership-less account.
		const data = (await submissionsLoader({
			context: CONTEXT,
			request: new Request("http://localhost/admin/submissions", {
				headers: { Cookie: cookie },
			}),
			params: {},
		} as unknown as Parameters<typeof submissionsLoader>[0])) as {
			data?: { submissions: unknown[]; eventName: string | null };
			submissions?: unknown[];
			eventName?: string | null;
		};

		const payload =
			"data" in data && data.data !== undefined ? data.data : data;
		expect(payload.eventName).toBeNull();
		expect(payload.submissions).toHaveLength(0);
	});

	it("rejects a too-short password with a field error and creates no account", async () => {
		const result = await act({
			name: "Ada",
			email: "ada@example.com",
			password: "short",
		});

		expect(result).toHaveProperty("fieldErrors");
		expect(
			(result as { fieldErrors?: { password?: string[] } }).fieldErrors
				?.password?.[0],
		).toBeTruthy();
		expect(await getDb(env).select().from(users)).toHaveLength(0);
	});
});
