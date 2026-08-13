import { env } from "cloudflare:test";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { contacts, participants, submissions } from "../app/db/schema";
import type { AccessiblePortal } from "../app/domain/portal";
import PortalResolver, {
	type PortalResolverData,
	loader as resolverLoader,
} from "../app/routes/portal";
import { loader as homeLoader } from "../app/routes/portals.$eventSlug.$portalId.home";
import PortalShell, {
	type PortalShellData,
	loader as shellLoader,
} from "../app/routes/portals.$eventSlug.$portalId";
import {
	authedRequest,
	BASE,
	catchThrown,
	CONTEXT,
	makeContact,
	makeUser,
	PORTAL_PARAMS,
	seedPortalWorld,
	thrownStatus,
	unwrap,
} from "./portal.helpers";

type LoaderArgs = Parameters<typeof homeLoader>[0];
type ResolverArgs = Parameters<typeof resolverLoader>[0];
type ShellArgs = Parameters<typeof shellLoader>[0];
type ResolverPayload = PortalResolverData;
type ShellPayload = PortalShellData;

function renderResolver(data: ResolverPayload) {
	const RouteComponent = PortalResolver as unknown as ComponentType<{
		loaderData: ResolverPayload;
	}>;
	const RoutesStub = createRoutesStub([
		{
			path: "/portal",
			Component: () => createElement(RouteComponent, { loaderData: data }),
		},
	]);
	return renderToString(
		createElement(RoutesStub, { initialEntries: ["/portal"] }),
	);
}

function renderShell(data: PortalShellData) {
	const RouteComponent = PortalShell as unknown as ComponentType<{
		loaderData: PortalShellData;
	}>;
	const RoutesStub = createRoutesStub([
		{
			path: "/portals/:eventSlug/:portalId/home",
			Component: () => createElement(RouteComponent, { loaderData: data }),
		},
	]);
	return renderToString(
		createElement(RoutesStub, {
			initialEntries: [`${new URL(BASE).pathname}/home`],
		}),
	);
}

async function loadPortal(userId: string) {
	return resolverLoader({
		context: CONTEXT,
		request: await authedRequest(userId, "http://localhost/portal"),
		params: {},
	} as unknown as ResolverArgs);
}

describe("portal access chain", () => {
	it("gates a logged-out visitor at /login with zero data queried", async () => {
		await seedPortalWorld();
		const thrown = await catchThrown(async () =>
			homeLoader({
				context: CONTEXT,
				request: new Request(`${BASE}/home`),
				params: PORTAL_PARAMS,
			} as unknown as LoaderArgs),
		);
		expect(thrown).toBeInstanceOf(Response);
		expect(thrownStatus(thrown)).toBe(302);
		expect((thrown as Response).headers.get("Location")).toContain("/login");
	});

	it("404s an unknown event slug and a portal id from ANOTHER event (cross-tenant chain)", async () => {
		await seedPortalWorld();
		await makeUser("u1", "sam@example.com");
		for (const params of [
			{ eventSlug: "no-such-event", portalId: "portal-pub-1" },
			// Real portal id, wrong event: the portal→event join must refuse it.
			{ eventSlug: "testconf", portalId: "portal-pub-2" },
		]) {
			const thrown = await catchThrown(async () =>
				homeLoader({
					context: CONTEXT,
					request: await authedRequest("u1", `${BASE}/home`),
					params,
				} as unknown as LoaderArgs),
			);
			expect(thrownStatus(thrown)).toBe(404);
		}
	});

	it("links a userless contact by normalized email at first portal entry (roster→signup linking)", async () => {
		await seedPortalWorld();
		const db = getDb(env);
		await makeUser("u_dana", "dana@example.com");
		// Contact minted by someone else's submission — no user link yet.
		await makeContact("c_dana", "e1", "dana@example.com", null, "Dana", "O");
		await db
			.insert(submissions)
			.values({ id: "s1", eventId: "e1", title: "Panel", status: "pending" });
		await db
			.insert(participants)
			.values({ id: "p1", submissionId: "s1", contactId: "c_dana" });

		const result = await homeLoader({
			context: CONTEXT,
			request: await authedRequest("u_dana", `${BASE}/home`),
			params: PORTAL_PARAMS,
		} as unknown as LoaderArgs);
		const data = unwrap<{ submissions: Array<{ title: string }> }>(result);

		expect(data.submissions.map((s) => s.title)).toContain("Panel");
		const [linked] = await db
			.select({ userId: contacts.userId })
			.from(contacts)
			.where(eq(contacts.id, "c_dana"));
		expect(linked?.userId).toBe("u_dana");
	});

	it("never links a contact that belongs to a DIFFERENT user's email", async () => {
		await seedPortalWorld();
		const db = getDb(env);
		await makeUser("u_mallory", "mallory@example.com");
		await makeContact("c_priya", "e1", "priya@example.com", null, "Priya", "R");

		await homeLoader({
			context: CONTEXT,
			request: await authedRequest("u_mallory", `${BASE}/home`),
			params: PORTAL_PARAMS,
		} as unknown as LoaderArgs);

		const [row] = await db
			.select({ userId: contacts.userId })
			.from(contacts)
			.where(eq(contacts.id, "c_priya"));
		expect(row?.userId).toBeNull();
	});

	it("resolves /portal to the user's portal, and to the empty state when they have none", async () => {
		await seedPortalWorld();
		await makeUser("u1", "sam@example.com");
		await makeContact("c1", "e1", "sam@example.com", "u1");
		const thrown = await catchThrown(async () =>
			resolverLoader({
				context: CONTEXT,
				request: await authedRequest("u1", "http://localhost/portal"),
				params: {},
			} as unknown as Parameters<typeof resolverLoader>[0]),
		);
		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).headers.get("Location")).toBe(
			"/portals/testconf/portal-pub-1/home",
		);
		await makeUser("u_nobody", "nobody@example.com");
		const result = unwrap<ResolverPayload>(
			await resolverLoader({
				context: CONTEXT,
				request: await authedRequest("u_nobody", "http://localhost/portal"),
				params: {},
			} as unknown as ResolverArgs),
		);
		expect(result).toEqual({ choices: [] });
	});

	it("keeps a single-event speaker on the existing portal redirect", async () => {
		await seedPortalWorld();
		await makeUser("u_one", "one@example.com");
		await makeContact("c_one", "e1", "one@example.com", "u_one");
		const thrown = await catchThrown(() => loadPortal("u_one"));
		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).headers.get("Location")).toBe(
			"/portals/testconf/portal-pub-1/home",
		);
	});

	it("shows every event a speaker belongs to instead of picking one", async () => {
		await seedPortalWorld();
		await makeUser("u_both", "both@example.com");
		await makeContact("c_test", "e1", "both@example.com", "u_both");
		await makeContact("c_other", "e2", "both@example.com", "u_both");

		const result = await loadPortal("u_both");
		expect(result).not.toBeInstanceOf(Response);
		const payload = unwrap<{ choices: AccessiblePortal[] }>(result);
		expect(payload.choices).toEqual([
			{
				eventName: "OtherConf",
				href: "/portals/otherconf/portal-pub-2/home",
			},
			{
				eventName: "TestConf",
				href: "/portals/testconf/portal-pub-1/home",
			},
		]);

		const html = renderResolver(payload);
		expect(html).toContain("OtherConf");
		expect(html).toContain("TestConf");
		expect(html).toContain("/portals/otherconf/portal-pub-2/home");
		expect(html).toContain("/portals/testconf/portal-pub-1/home");
		expect(html).not.toContain("/admin");
	});

	it("lists the speaker's other events from inside a portal", async () => {
		await seedPortalWorld();
		await makeUser("u_both", "both@example.com");
		await makeContact("c_test", "e1", "both@example.com", "u_both");
		await makeContact("c_other", "e2", "both@example.com", "u_both");

		const result = await shellLoader({
			context: CONTEXT,
			request: await authedRequest("u_both", `${BASE}/home`),
			params: PORTAL_PARAMS,
		} as unknown as ShellArgs);
		const payload = unwrap<ShellPayload>(result);
		expect(payload.portals).toEqual([
			{
				eventName: "OtherConf",
				href: "/portals/otherconf/portal-pub-2/home",
			},
			{
				eventName: "TestConf",
				href: "/portals/testconf/portal-pub-1/home",
			},
		]);
		const html = renderShell(payload);
		expect(html).toContain("OtherConf");
		expect(html).toContain("TestConf");
		expect(html).toContain("/portals/otherconf/portal-pub-2/home");
		expect(html).not.toContain("/admin");
	});
});
