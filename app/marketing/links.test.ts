import { describe, expect, it } from "vitest";
// The homepage links into routes that other lanes own. Two oracles guard them:
// docs/ROUTE-MAP.md (the authoritative URL assignment — a link that isn't in it
// is a typo or an unclaimed route) and the route files themselves. While a
// URL's map row says its owning lane hasn't landed yet, only the assignment is
// checked; once the row's status flips, the route file must exist — after the
// build wave completes this degenerates to strict route existence.
import routeMap from "../../docs/ROUTE-MAP.md?raw";
import contentSource from "./content.ts?raw";
import landingSource from "./landing.tsx?raw";

const routeFiles = new Set(
	Object.keys(import.meta.glob("../routes/*.tsx")).map((p) =>
		p.replace("../routes/", ""),
	),
);

function internalLinks(source: string): string[] {
	return [...source.matchAll(/\b(?:to|href)[:=]\s*"(\/[^"]*)"/g)].flatMap(
		(m) => (m[1] === undefined ? [] : [m[1]]),
	);
}

function routeFileExists(link: string): boolean {
	if (link === "/") return routeFiles.has("_index.tsx");
	const segment = link.slice(1);
	return (
		routeFiles.has(`${segment}.tsx`) || routeFiles.has(`${segment}._index.tsx`)
	);
}

function mapRowIsTodo(link: string): boolean {
	const row = routeMap
		.split("\n")
		.find((line) => line.includes(`\`${link}\``) && line.startsWith("|"));
	return row !== undefined && /\|\s*todo\s*\|?\s*$/.test(row);
}

describe("marketing internal links", () => {
	const links = [
		...new Set([
			...internalLinks(landingSource),
			...internalLinks(contentSource),
		]),
	];

	it("finds the links (extraction is not silently broken)", () => {
		expect(links.length).toBeGreaterThanOrEqual(6);
	});

	it.each(links)("%s is a URL assigned in ROUTE-MAP.md", (link) => {
		expect(routeMap).toContain(`\`${link}\``);
	});

	it.each(links)("%s resolves to a route file once its lane lands", (link) => {
		expect(
			routeFileExists(link) || mapRowIsTodo(link),
			`"${link}" has no route file and its ROUTE-MAP row is no longer todo`,
		).toBe(true);
	});
});
