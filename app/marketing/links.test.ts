import { describe, expect, it } from "vitest";
// The homepage links into routes that other lanes own. ROUTE-MAP.md is the
// authoritative URL assignment, so a marketing link that isn't in the map is
// either a typo or an unclaimed route — both would 404 in production.
import routeMap from "../../docs/ROUTE-MAP.md?raw";
import contentSource from "./content.ts?raw";
import landingSource from "./landing.tsx?raw";

function internalLinks(source: string): string[] {
	return [...source.matchAll(/\bto[:=]\s*"(\/[^"]*)"/g)].map((m) => m[1]);
}

describe("marketing internal links", () => {
	it("every internal link targets a URL assigned in ROUTE-MAP.md", () => {
		const links = new Set([
			...internalLinks(landingSource),
			...internalLinks(contentSource),
		]);
		expect(links.size).toBeGreaterThan(0);
		for (const link of links) {
			expect(routeMap, `"${link}" is not an assigned URL`).toContain(
				`\`${link}\``,
			);
		}
	});
});
