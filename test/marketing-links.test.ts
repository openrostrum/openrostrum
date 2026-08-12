import { describe, expect, it } from "vitest";
// The homepage links into routes that other lanes own. Two oracles guard them:
// docs/ROUTE-MAP.md (the authoritative URL assignment — a link that isn't in it
// is a typo or an unclaimed route) and the route files themselves.
import routeMap from "../docs/ROUTE-MAP.md?raw";
import contentSource from "../app/marketing/content.ts?raw";
import landingSource from "../app/marketing/landing.tsx?raw";

const routeFiles = new Set(
	Object.keys(import.meta.glob("../app/routes/*.tsx")).map((p) =>
		p.replace("../app/routes/", ""),
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

// While a URL's map row says its owning lane hasn't landed, only the assignment
// is checked; once the status flips, the route file must exist — so after the
// build wave this degenerates to strict route existence.
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

	it("every internal link is a URL assigned in ROUTE-MAP.md", () => {
		for (const link of links) {
			expect(routeMap, `"${link}" is not an assigned URL`).toContain(
				`\`${link}\``,
			);
		}
	});

	it("every internal link resolves to a route file once its lane lands", () => {
		for (const link of links) {
			expect(
				routeFileExists(link) || mapRowIsTodo(link),
				`"${link}" has no route file and its ROUTE-MAP row is no longer todo`,
			).toBe(true);
		}
	});
});
