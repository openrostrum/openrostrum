import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { embeds, events } from "../app/db/schema";
import { loader } from "../app/routes/feeds.$eventSlug.$kind";
import { CONTEXT, seedProgram } from "./program.fixtures";

// The feeds are third-party contracts: shape, escaping, calendar validity,
// and the same public projection as the pages (no PII, approved-only).

function fetchFeed(
	path: string,
	slugAndKind?: { slug?: string; kind: string },
) {
	const url = new URL(`http://localhost${path}`);
	const segments = url.pathname.split("/");
	return loader({
		context: CONTEXT,
		request: new Request(url),
		params: {
			eventSlug: slugAndKind?.slug ?? segments[2] ?? "",
			kind: slugAndKind?.kind ?? segments[3] ?? "",
		},
	} as never) as Promise<Response>;
}

describe("program feeds", () => {
	it("sessions.json carries the public projection only", async () => {
		await seedProgram();
		const res = await fetchFeed("/feeds/devflow/sessions.json");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("application/json");
		const body = (await res.json()) as {
			event: { slug: string };
			sessions: Array<{ id: string; speakers: Array<{ name: string }> }>;
		};
		expect(body.event.slug).toBe("devflow");
		expect(body.sessions.map((s) => s.id)).toEqual(["s1", "s2", "s5"]);
		const raw = JSON.stringify(body);
		expect(raw).not.toMatch(/@px\.test|555-0001/);
		expect(raw).not.toMatch(/Hidden Person/);
	});

	it("sessions.xml escapes markup-significant characters", async () => {
		await seedProgram();
		const res = await fetchFeed("/feeds/devflow/sessions.xml");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("application/xml");
		const xml = await res.text();
		expect(xml).toContain(
			"<title>Taming 40-Minute CI &amp; &lt;Scale&gt;</title>",
		);
		expect(xml).toContain("<company>Widgets &amp; &lt;Co&gt;</company>");
		expect(xml).not.toContain("<Scale>"); // raw injection would break consumers
	});

	it("agenda.ics is a valid calendar of scheduled sessions with stable UIDs, filterable by ?ids=", async () => {
		await seedProgram();
		const res = await fetchFeed("/feeds/devflow/agenda.ics");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/calendar");
		const ics = await res.text();
		expect(ics).toContain("BEGIN:VCALENDAR");
		expect(ics).toContain("END:VCALENDAR");
		expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2); // s1 + s2; s5 has no slot
		expect(ics).toContain("UID:or-session-s1@openrostrum");
		expect(ics).toContain("DTSTART:20270512T163000Z");
		expect(ics).toContain("LOCATION:Main Hall");

		const filtered = await fetchFeed("/feeds/devflow/agenda.ics?ids=s1");
		const filteredIcs = await filtered.text();
		expect(filteredIcs.match(/BEGIN:VEVENT/g)).toHaveLength(1);
		expect(filteredIcs).toContain("UID:or-session-s1@openrostrum");
	});

	it("agenda.ics LOCATION carries the venue because a calendar entry has no page header", async () => {
		await seedProgram();
		await getDb(CONTEXT.cloudflare.env).update(events).set({
			location: "Yerba Buena Center for the Arts, San Francisco, California",
		});
		const ics = await (await fetchFeed("/feeds/devflow/agenda.ics")).text();
		// RFC 5545 escapes commas in TEXT; unfold to assert the value.
		const location = ics
			.replace(/\r\n /g, "")
			.split("\r\n")
			.find((line) => line.startsWith("LOCATION:"));
		expect(location).toBe(
			"LOCATION:Main Hall\\, Yerba Buena Center for the Arts\\, San Francisco\\, California",
		);
	});

	it("agenda.ics is gated on the publish action", async () => {
		await seedProgram({ agendaPublished: false });
		const res = await fetchFeed("/feeds/devflow/agenda.ics");
		expect(res.status).toBe(404);
	});

	it("agenda embed feeds stay gated until the agenda is published", async () => {
		await seedProgram({ agendaPublished: false });
		await getDb(CONTEXT.cloudflare.env)
			.update(embeds)
			.set({ type: "agenda" })
			.where(eq(embeds.id, "emb1"));

		for (const kind of [
			"sessions.html",
			"sessions.json",
			"sessions.xml",
		] as const) {
			expect(
				(await fetchFeed(`/feeds/devflow/${kind}?embed=pub-emb-1`)).status,
			).toBe(404);
		}
		const widget = await fetchFeed("/feeds/devflow/widget.js?embed=pub-emb-1");
		expect(widget.status).toBe(200);
		expect(await widget.text()).toContain("/embed/");
	});

	it("speakers.json derives from the same projection (hidden speaker absent)", async () => {
		await seedProgram();
		const res = await fetchFeed("/feeds/devflow/speakers.json");
		const body = (await res.json()) as {
			speakers: Array<{ name: string; sessions: unknown[] }>;
		};
		expect(body.speakers.map((sp) => sp.name)).toEqual([
			"Bo Alvarez",
			"Ada Zhang",
		]);
		expect(JSON.stringify(body)).not.toMatch(/@px\.test/);
	});

	it("basic HTML writes a role the house way — escaped parts, plain separator", async () => {
		await seedProgram();
		const speakers = await (
			await fetchFeed("/feeds/devflow/speakers.html")
		).text();
		// The separator is markup the consumer restyles, not user input: escaping
		// each part and joining after is the only order that produces both.
		expect(speakers).toContain(
			'<p class="or-role">Engineer · Widgets &amp; &lt;Co&gt;</p>',
		);

		const sessions = await (
			await fetchFeed("/feeds/devflow/sessions.html")
		).text();
		expect(sessions).toContain(
			"Bo Alvarez — Engineer · Widgets &amp; &lt;Co&gt;",
		);
	});

	it("?embed= applies that embed's filters; a disabled embed 404s", async () => {
		await seedProgram();
		const res = await fetchFeed("/feeds/devflow/sessions.json?embed=pub-emb-1");
		const body = (await res.json()) as { sessions: Array<{ id: string }> };
		expect(body.sessions.map((s) => s.id)).toEqual(["s1"]); // trackIds: [t1]

		const disabled = await fetchFeed(
			"/feeds/devflow/sessions.json?embed=pub-emb-2",
		);
		expect(disabled.status).toBe(404);
		expect(
			(await fetchFeed("/feeds/devflow/widget.js?embed=pub-emb-2")).status,
		).toBe(404);
	});

	it("applies one saved embed filter to basic HTML, JSON, XML, and iCal", async () => {
		await seedProgram();
		const query = "?embed=pub-emb-1";

		const htmlResponse = await fetchFeed(
			`/feeds/devflow/sessions.html${query}`,
		);
		expect(htmlResponse.status).toBe(200);
		expect(htmlResponse.headers.get("Content-Type")).toContain("text/html");
		const html = await htmlResponse.text();
		expect(html).toContain('id="session-s1"');
		expect(html).not.toContain('id="session-s2"');
		expect(html).not.toContain('id="session-s5"');

		const jsonResponse = await fetchFeed(
			`/feeds/devflow/sessions.json${query}`,
		);
		const json = (await jsonResponse.json()) as {
			sessions: Array<{ id: string }>;
		};
		expect(json.sessions.map((session) => session.id)).toEqual(["s1"]);

		const xmlResponse = await fetchFeed(`/feeds/devflow/sessions.xml${query}`);
		expect(xmlResponse.status).toBe(200);
		const xml = await xmlResponse.text();
		expect(xml).toContain('<session id="s1">');
		expect(xml).not.toContain('<session id="s2">');
		expect(xml).not.toContain('<session id="s5">');

		const iCalResponse = await fetchFeed(`/feeds/devflow/agenda.ics${query}`);
		expect(iCalResponse.status).toBe(200);
		const iCal = await iCalResponse.text();
		expect(iCal).toContain("UID:or-session-s1@openrostrum");
		expect(iCal).not.toContain("UID:or-session-s2@openrostrum");
	});

	it("serves the widget loader script and 404s unknown kinds/formats", async () => {
		await seedProgram();
		const js = await fetchFeed("/feeds/devflow/widget.js");
		expect(js.headers.get("Content-Type")).toContain("text/javascript");
		expect(await js.text()).toContain("/embed/");

		expect((await fetchFeed("/feeds/devflow/bogus.json")).status).toBe(404);
		expect((await fetchFeed("/feeds/devflow/sessions.csv")).status).toBe(404);
		expect((await fetchFeed("/feeds/devflow/sessions")).status).toBe(404);
		expect(
			(
				await fetchFeed("/feeds/nope/sessions.json", {
					slug: "nope",
					kind: "sessions.json",
				})
			).status,
		).toBe(404);
	});
});
