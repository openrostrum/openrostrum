import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { embeds } from "../app/db/schema";
import { loader } from "../app/routes/embed.$publicId";
import type { SessionsSurfaceData } from "../app/widgets/types";
import { CONTEXT, seedProgram, thrownStatus, unwrap } from "./program.fixtures";

function callEmbed(publicId: string, search = "") {
	return loader({
		context: CONTEXT,
		request: new Request(`http://localhost/embed/${publicId}${search}`),
		params: { publicId },
	} as never);
}

describe("embed render route", () => {
	it("renders an enabled embed with its configured filters applied", async () => {
		await seedProgram();
		const { data } = unwrap<{
			surface: { type: string; data: SessionsSurfaceData };
			hiddenFields: string[];
		}>(await callEmbed("pub-emb-1"));
		expect(data.surface.type).toBe("sessions");
		expect(data.surface.data.sessions.map((s) => s.id)).toEqual(["s1"]);
		expect(JSON.stringify(data)).not.toMatch(/@px\.test/);
	});

	it("404s a disabled embed and an unknown publicId", async () => {
		await seedProgram();
		await callEmbed("pub-emb-2").then(
			() => {
				throw new Error("expected 404");
			},
			(error) => expect(thrownStatus(error)).toBe(404),
		);
		await callEmbed("does-not-exist").then(
			() => {
				throw new Error("expected 404");
			},
			(error) => expect(thrownStatus(error)).toBe(404),
		);
	});

	it("agenda-type embeds respect the publish gate", async () => {
		await seedProgram({ agendaPublished: false });
		await getDb(env).insert(embeds).values({
			id: "emb3",
			eventId: "e1",
			publicId: "pub-emb-agenda",
			name: "Agenda widget",
			type: "agenda",
			enabled: true,
			config: {},
		});
		const { data } = unwrap<{ surface: { type: string; data: unknown } }>(
			await callEmbed("pub-emb-agenda"),
		);
		expect(data.surface.type).toBe("agenda");
		expect(data.surface.data).toBeNull();
		expect(JSON.stringify(data)).not.toMatch(/Taming/);
	});
});
