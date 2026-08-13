import { env } from "cloudflare:test";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { embeds } from "../app/db/schema";
import EmbedPage, { loader } from "../app/routes/embed.$publicId";
import type { SessionsSurfaceData } from "../app/lib/program-types";
import { CONTEXT, seedProgram, thrownStatus, unwrap } from "./program.fixtures";

function callEmbed(publicId: string, search = "") {
	return loader({
		context: CONTEXT,
		request: new Request(`http://localhost/embed/${publicId}${search}`),
		params: { publicId },
	} as never);
}

type EmbedData = Awaited<ReturnType<typeof loader>>["data"];

function renderEmbed(loaderData: EmbedData, publicId: string) {
	const RouteComponent = EmbedPage as unknown as ComponentType<{
		loaderData: EmbedData;
		params: { publicId: string };
	}>;
	const RoutesStub = createRoutesStub([
		{
			path: "/embed/:publicId",
			Component: () =>
				createElement(RouteComponent, { loaderData, params: { publicId } }),
		},
	]);
	return renderToString(
		createElement(RoutesStub, { initialEntries: [`/embed/${publicId}`] }),
	);
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

	it("links an agenda detail's room to the standalone session filter", async () => {
		await seedProgram();
		await getDb(env).insert(embeds).values({
			id: "emb3",
			eventId: "e1",
			publicId: "pub-emb-agenda",
			name: "Agenda widget",
			type: "agenda",
			enabled: true,
			config: {},
		});
		const { data } = unwrap<EmbedData>(
			await callEmbed("pub-emb-agenda", "?session=s1"),
		);

		expect(renderEmbed(data, "pub-emb-agenda")).toContain(
			'href="/sessions/devflow?room=r1"',
		);
	});

	it("hides Track only when the organizer hid that field on the embed", async () => {
		await seedProgram();
		await getDb(env)
			.insert(embeds)
			.values([
				{
					id: "emb-agenda-shown",
					eventId: "e1",
					publicId: "pub-emb-agenda-shown",
					name: "Agenda with tracks",
					type: "agenda",
					enabled: true,
					config: {},
				},
				{
					id: "emb-agenda-hidden",
					eventId: "e1",
					publicId: "pub-emb-agenda-hidden",
					name: "Agenda without tracks",
					type: "agenda",
					enabled: true,
					config: { hiddenFields: ["track"] },
				},
			]);

		const shown = unwrap<EmbedData>(
			await callEmbed("pub-emb-agenda-shown", "?session=s1"),
		);
		expect(renderEmbed(shown.data, "pub-emb-agenda-shown")).toContain(
			">Track</span>",
		);
		expect(renderEmbed(shown.data, "pub-emb-agenda-shown")).toContain(
			"Platform &amp; Infra",
		);

		const hidden = unwrap<EmbedData>(
			await callEmbed("pub-emb-agenda-hidden", "?session=s1"),
		);
		const hiddenHtml = renderEmbed(hidden.data, "pub-emb-agenda-hidden");
		expect(hiddenHtml).toContain("Taming 40-Minute CI");
		expect(hiddenHtml).not.toContain(">Track</span>");
		expect(hiddenHtml).not.toContain("Platform &amp; Infra");
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
