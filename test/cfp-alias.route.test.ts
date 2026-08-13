import { env } from "cloudflare:test";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { events, forms, organizations } from "../app/db/schema";
import { loader } from "../app/routes/cfp";
import EventCfp, {
	loader as eventCfpLoader,
} from "../app/routes/cfp.$eventSlug";
import { thrownStatus } from "./thrown";

// `/cfp` is the homepage's stable "Call for speakers" URL: it must land on
// the default event's oldest OPEN submission form and never dead-end (no
// open form → homepage, not a 404). `/cfp/:eventSlug` is this organizer's
// channel-ready alias — same oldest-open rule, scoped to that event.

type LoaderArgs = Parameters<typeof loader>[0];
type EventLoaderArgs = Parameters<typeof eventCfpLoader>[0];
const CONTEXT = { cloudflare: { env, ctx: {} } };

function call() {
	return loader({
		context: CONTEXT,
		request: new Request("http://localhost/cfp"),
		params: {},
	} as unknown as LoaderArgs);
}

function callEvent(slug: string) {
	return eventCfpLoader({
		context: CONTEXT,
		request: new Request(`http://localhost/cfp/${slug}`),
		params: { eventSlug: slug },
	} as unknown as EventLoaderArgs);
}

async function seedEvent() {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	await db
		.insert(events)
		.values({ id: "e1", organizationId: "org1", name: "Conf", slug: "conf" });
	return db;
}

describe("/cfp alias", () => {
	it("redirects to the default event's oldest open form", async () => {
		const db = await seedEvent();
		await db.insert(forms).values([
			{
				id: "f_closed",
				eventId: "e1",
				publicId: "closed-uuid",
				internalName: "Closed",
				status: "closed",
				createdAt: new Date("2026-01-01"),
			},
			{
				id: "f_open",
				eventId: "e1",
				publicId: "open-uuid",
				internalName: "Open",
				status: "open",
				createdAt: new Date("2026-02-01"),
			},
			{
				id: "f_open_later",
				eventId: "e1",
				publicId: "later-uuid",
				internalName: "Open later",
				status: "open",
				createdAt: new Date("2026-03-01"),
			},
		]);
		const res = await call();
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/submit/conf/open-uuid");
	});

	it("falls back to the homepage when nothing is open (and when no event exists)", async () => {
		const db = await seedEvent();
		await db.insert(forms).values({
			id: "f_draft",
			eventId: "e1",
			publicId: "draft-uuid",
			internalName: "Draft",
			status: "draft",
		});
		const res = await call();
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/");
	});

	it("skips a stored-open form whose close date has already passed", async () => {
		const db = await seedEvent();
		await db.insert(forms).values([
			{
				id: "f_expired",
				eventId: "e1",
				publicId: "expired-uuid",
				internalName: "Expired",
				status: "open",
				closeAt: new Date("2020-01-01T00:00:00Z"),
				createdAt: new Date("2026-01-01"),
			},
			{
				id: "f_live",
				eventId: "e1",
				publicId: "live-uuid",
				internalName: "Live",
				status: "open",
				createdAt: new Date("2026-03-01"),
			},
		]);
		const res = await call();
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/submit/conf/live-uuid");
	});
});

describe("/cfp/:eventSlug", () => {
	it("redirects to this event's oldest open form", async () => {
		const db = await seedEvent();
		await db.insert(organizations).values({ id: "org2", name: "Other" });
		await db.insert(events).values({
			id: "e2",
			organizationId: "org2",
			name: "Other Conf",
			slug: "other-conf",
		});
		await db.insert(forms).values([
			{
				id: "f_closed",
				eventId: "e1",
				publicId: "closed-uuid",
				internalName: "Closed",
				status: "closed",
				createdAt: new Date("2026-01-01"),
			},
			{
				id: "f_open",
				eventId: "e1",
				publicId: "open-uuid",
				internalName: "Open",
				status: "open",
				createdAt: new Date("2026-02-01"),
			},
			{
				id: "f_open_later",
				eventId: "e1",
				publicId: "later-uuid",
				internalName: "Open later",
				status: "open",
				createdAt: new Date("2026-03-01"),
			},
			{
				id: "f_other_open",
				eventId: "e2",
				publicId: "other-open-uuid",
				internalName: "Other open",
				status: "open",
				createdAt: new Date("2026-01-15"),
			},
		]);
		const res = await callEvent("conf");
		expect(res).toBeInstanceOf(Response);
		expect((res as Response).status).toBe(302);
		expect((res as Response).headers.get("Location")).toBe(
			"/submit/conf/open-uuid",
		);
	});

	it("does not advertise a draft UUID when nothing is open", async () => {
		const db = await seedEvent();
		await db.insert(forms).values({
			id: "f_draft",
			eventId: "e1",
			publicId: "draft-uuid",
			internalName: "Draft",
			status: "draft",
		});
		const result = await callEvent("conf");
		expect(result).not.toBeInstanceOf(Response);
		const data = result as { eventName: string };
		expect(data.eventName).toBe("Conf");
		const RouteComponent = EventCfp as unknown as ComponentType<{
			loaderData: { eventName: string };
		}>;
		const RoutesStub = createRoutesStub([
			{
				path: "/cfp/:eventSlug",
				Component: () => createElement(RouteComponent, { loaderData: data }),
			},
		]);
		const html = renderToString(
			createElement(RoutesStub, { initialEntries: ["/cfp/conf"] }),
		);
		expect(html).not.toContain("draft-uuid");
		expect(html).not.toContain("/submit/");
	});

	it("404s when the event slug does not exist", async () => {
		await seedEvent();
		let thrown: unknown;
		try {
			await callEvent("missing");
		} catch (error) {
			thrown = error;
		}
		expect(thrownStatus(thrown)).toBe(404);
	});
});
