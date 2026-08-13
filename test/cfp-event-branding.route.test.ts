import { createElement, type ComponentType } from "react";
import { env } from "cloudflare:test";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { events, forms, organizations } from "../app/db/schema";
import {
	loader as publicFormLoader,
	default as SubmitLayout,
} from "../app/routes/submit.$eventSlug.$formId";
import { unwrap } from "./route-data";

const CONTEXT = { cloudflare: { env, ctx: {} } };

type PublicLoaderData = {
	event: { name: string; slug: string; timezone: string };
	form: {
		publicId: string;
		externalTitle: string;
		pageHeading: string;
		welcomeHtml: string | null;
		participantsStep: boolean;
		autoRedirect: boolean;
	};
	closed: boolean;
	closeBanner: string | null;
	limit: number | null;
	user: { name: string | null; email: string } | null;
	portalPath: string | null;
};

async function seedTwoEvents() {
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	await db.insert(events).values([
		{
			id: "e_a",
			organizationId: "org1",
			name: "DevFlow Conf 2027",
			slug: "devflow-conf-2027",
		},
		{
			id: "e_b",
			organizationId: "org1",
			name: "Forward Summit 2028",
			slug: "forward-summit-2028",
		},
	]);
	await db.insert(forms).values([
		{
			id: "f_a",
			eventId: "e_a",
			publicId: "form-devflow",
			type: "session",
			status: "open",
			internalName: "DevFlow CFP",
			externalTitle: "DevFlow Conf 2027 — Call for Speakers",
		},
		{
			id: "f_b",
			eventId: "e_b",
			publicId: "form-forward",
			type: "session",
			status: "open",
			internalName: "Untitled form",
			externalTitle: "",
		},
	]);
	return db;
}

function renderSubmit(loaderData: PublicLoaderData, path: string): string {
	const RouteComponent = SubmitLayout as unknown as ComponentType<{
		loaderData: PublicLoaderData;
	}>;
	const RoutesStub = createRoutesStub([
		{
			path: "/submit/:eventSlug/:formId",
			Component: () => createElement(RouteComponent, { loaderData }),
		},
	]);
	return renderToString(createElement(RoutesStub, { initialEntries: [path] }));
}

describe("public CFP event branding", () => {
	it("shows event B's name on event B's form and never event A's", async () => {
		await seedTwoEvents();

		const result = unwrap<PublicLoaderData>(
			await publicFormLoader({
				context: CONTEXT,
				request: new Request(
					"http://localhost/submit/forward-summit-2028/form-forward",
				),
				params: {
					eventSlug: "forward-summit-2028",
					formId: "form-forward",
				},
			} as unknown as Parameters<typeof publicFormLoader>[0]),
		);

		expect(result.event.name).toBe("Forward Summit 2028");
		expect(result.event.name).not.toBe("DevFlow Conf 2027");
		expect(result.form.externalTitle).toContain("Forward Summit 2028");
		expect(result.form.externalTitle).not.toContain("DevFlow Conf 2027");

		const html = renderSubmit(
			result,
			"/submit/forward-summit-2028/form-forward",
		);
		expect(html).toContain("Forward Summit 2028");
		expect(html).not.toContain("DevFlow Conf 2027");
	});
});
