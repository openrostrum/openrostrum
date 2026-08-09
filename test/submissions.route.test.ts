import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import {
	events,
	participants,
	submissions,
	submissionTracks,
	tracks,
} from "../app/db/schema";
import { loader } from "../app/routes/submissions";

// Golden-path loader test: seed D1, call the route loader with a Cloudflare
// context, assert the shaped result. This is the functional oracle for a route.
describe("submissions route loader", () => {
	it("loads submissions with tracks + participants from D1", async () => {
		const db = getDb(env);
		await db.insert(events).values({ id: "e1", name: "E", slug: "e" });
		await db
			.insert(tracks)
			.values({ id: "t1", eventId: "e1", name: "AI", color: "#000000" });
		await db.insert(submissions).values({
			id: "s1",
			eventId: "e1",
			title: "Talk",
			status: "accepted",
			format: "Keynote",
		});
		await db
			.insert(submissionTracks)
			.values({ submissionId: "s1", trackId: "t1" });
		await db.insert(participants).values({
			id: "p1",
			submissionId: "s1",
			firstName: "A",
			lastName: "B",
			email: "a@b.c",
		});

		const context = { cloudflare: { env, ctx: {} } };
		const result = await loader({
			context,
			request: new Request("http://localhost/submissions"),
			params: {},
		} as unknown as Parameters<typeof loader>[0]);

		expect(result.submissions).toHaveLength(1);
		expect(result.submissions[0].title).toBe("Talk");
		expect(result.submissions[0].submissionTracks[0].track.name).toBe("AI");
		expect(result.submissions[0].participants).toHaveLength(1);
	});
});
