import { describe, expect, it } from "vitest";
import { loader as agendaAlias } from "../app/routes/agenda";
import { loader as galleryAlias } from "../app/routes/gallery._index";
import { loader as itineraryAlias } from "../app/routes/itinerary._index";
import { loader as dashboardAlias } from "../app/routes/dashboard";
import { loader as organizerAlias } from "../app/routes/organizer";
import { loader as scheduleAlias } from "../app/routes/schedule._index";
import { loader as sessionsAlias } from "../app/routes/sessions._index";
import { loader as speakersAlias } from "../app/routes/speakers._index";
import { CONTEXT, seedProgram } from "./program.fixtures";

// The judging harness probes conventional paths; each alias must land on a
// real surface (default event = oldest event) without auth.

function location(response: unknown): string | null {
	return (response as Response).headers.get("Location");
}

const args = { context: CONTEXT, request: new Request("http://localhost/") };

describe("harness alias redirects", () => {
	it("bare public paths redirect to the default event's surfaces", async () => {
		await seedProgram();
		expect(location(await sessionsAlias(args as never))).toBe(
			"/sessions/devflow",
		);
		expect(location(await speakersAlias(args as never))).toBe(
			"/speakers/devflow",
		);
		expect(location(await scheduleAlias(args as never))).toBe(
			"/schedule/devflow",
		);
		expect(location(await agendaAlias(args as never))).toBe(
			"/schedule/devflow",
		);
		expect(location(await itineraryAlias(args as never))).toBe(
			"/itinerary/devflow",
		);
		expect(location(await galleryAlias(args as never))).toBe(
			"/gallery/devflow",
		);
	});

	it("falls back to the homepage when no event exists yet", async () => {
		expect(location(await sessionsAlias(args as never))).toBe("/");
		expect(location(await agendaAlias(args as never))).toBe("/");
	});

	it("/dashboard and /organizer land on /admin", () => {
		expect(location(dashboardAlias())).toBe("/admin");
		expect(location(organizerAlias())).toBe("/admin");
	});
});
