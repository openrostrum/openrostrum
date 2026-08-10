import { describe, expect, it } from "vitest";
import { describeRouteError } from "../app/lib/error-page";

// The root boundary's copy contract: raw errors carry SQL/row values/paths,
// so nothing from the error object may reach the page outside dev builds.

/** Shape isRouteErrorResponse recognizes (status + statusText + internal + data). */
function routeErrorResponse(status: number) {
	return { status, statusText: "", internal: false, data: "boom" };
}

describe("describeRouteError", () => {
	it("maps a 404 response to not-found copy without leaking the response body", () => {
		const content = describeRouteError(routeErrorResponse(404), false);
		expect(content.title).toBe("Page not found");
		expect(content.detail).toBeUndefined();
		expect(JSON.stringify(content)).not.toContain("boom");
	});

	it("names the HTTP status for non-404 responses, never the body", () => {
		const content = describeRouteError(routeErrorResponse(503), false);
		expect(content.body).toContain("503");
		expect(content.detail).toBeUndefined();
		expect(JSON.stringify(content)).not.toContain("boom");
	});

	it("NEVER exposes message or stack outside dev — even for unexpected errors", () => {
		const error = new Error("SELECT * FROM users WHERE secret = 'hunter2'");
		const content = describeRouteError(error, false);
		expect(content.detail).toBeUndefined();
		expect(JSON.stringify(content)).not.toContain("hunter2");
	});

	it("keeps the stack available in dev builds", () => {
		const error = new Error("dev-only diagnostic");
		const content = describeRouteError(error, true);
		expect(content.detail).toContain("dev-only diagnostic");
	});
});
