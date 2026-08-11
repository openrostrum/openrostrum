import viteConfig from "../vite.config.ts?raw";
import { describe, expect, it } from "vitest";

describe("local Vite configuration", () => {
	it("disables remote binding proxy sessions", () => {
		expect(viteConfig).toMatch(
			/cloudflare\(\{[\s\S]*?remoteBindings:\s*false,[\s\S]*?\}\),/,
		);
	});
});
