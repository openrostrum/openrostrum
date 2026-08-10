import { describe, expect, it } from "vitest";
import { documentScheme, getTheme, themeCookie } from "../app/lib/theme";
import { action } from "../app/routes/theme";

// Oracle: the tri-state theme decision — System / Light / Dark, persisted as
// a cookie so SSR renders the right scheme with no flash; pins (marketing
// light, embed os) outrank the cookie. See docs/rules/design-system.md.

async function postTheme(
	theme: string,
	url = "http://localhost/theme",
): Promise<Response> {
	const request = new Request(url, {
		method: "POST",
		body: new URLSearchParams({ theme }),
	});
	return (await action({
		context: { cloudflare: { env: {}, ctx: {} } },
		request,
		params: {},
	} as unknown as Parameters<typeof action>[0])) as Response;
}

describe("theme action", () => {
	it("persists an explicit choice as a year-long Lax cookie that round-trips", async () => {
		const response = await postTheme("dark");
		expect(response.status).toBe(200);
		const cookie = response.headers.get("Set-Cookie") ?? "";
		expect(cookie).toContain("or_theme=dark");
		expect(cookie).toContain("Max-Age=31536000");
		expect(cookie).toContain("Path=/");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("HttpOnly");
		// The cookie the action sets is the theme the next request parses.
		const next = new Request("http://localhost/admin", {
			headers: { Cookie: cookie.split(";")[0] ?? "" },
		});
		expect(getTheme(next)).toBe("dark");
	});

	it("System clears the override instead of storing a value", async () => {
		const response = await postTheme("system");
		expect(response.status).toBe(200);
		const cookie = response.headers.get("Set-Cookie") ?? "";
		expect(cookie).toContain("or_theme=;");
		expect(cookie).toContain("Max-Age=0");
		const next = new Request("http://localhost/admin", {
			headers: { Cookie: cookie.split(";")[0] ?? "" },
		});
		expect(getTheme(next)).toBe("system");
	});

	it("rejects an unknown theme without touching the cookie", async () => {
		const response = await postTheme("solarized");
		expect(response.status).toBe(400);
		expect(response.headers.get("Set-Cookie")).toBeNull();
	});

	it("marks the cookie Secure only over https — Secure on local http makes browsers drop it", async () => {
		const http = await postTheme("dark", "http://localhost/theme");
		expect(http.headers.get("Set-Cookie") ?? "").not.toContain("Secure");
		const https = await postTheme("dark", "https://openrostrum.com/theme");
		expect(https.headers.get("Set-Cookie") ?? "").toContain("Secure");
	});
});

describe("getTheme", () => {
	it("treats an absent or tampered cookie as System", () => {
		expect(getTheme(new Request("http://localhost/"))).toBe("system");
		expect(
			getTheme(
				new Request("http://localhost/", {
					headers: { Cookie: "or_theme=purple" },
				}),
			),
		).toBe("system");
	});

	it("finds the theme among other cookies", () => {
		expect(
			getTheme(
				new Request("http://localhost/", {
					headers: { Cookie: "__session=abc; or_theme=light; other=1" },
				}),
			),
		).toBe("light");
	});
});

describe("documentScheme", () => {
	it("route pins outrank the visitor's choice: marketing stays light, embeds stay on the OS", () => {
		expect(documentScheme("light", "dark")).toBe("light");
		expect(documentScheme("os", "dark")).toBeNull();
	});

	it("without a pin, an explicit choice pins the document and System defers to the OS", () => {
		expect(documentScheme(null, "dark")).toBe("dark");
		expect(documentScheme(null, "light")).toBe("light");
		expect(documentScheme(null, "system")).toBeNull();
	});
});

describe("themeCookie", () => {
	it("never stores System — the absence of the cookie IS the default", () => {
		expect(themeCookie("system", false)).toContain("Max-Age=0");
		expect(themeCookie("light", false)).toContain("or_theme=light");
	});
});
