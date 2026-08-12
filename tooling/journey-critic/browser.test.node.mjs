import assert from "node:assert/strict";
import { test } from "node:test";
import { isBlockedRequest } from "./browser.mjs";

const origin = "https://openrostrum.com";
const guard = (overrides) =>
	isBlockedRequest({
		origin,
		ownedSlugs: new Set(["northbound-2026"]),
		readOnly: false,
		...overrides,
	});

test("reads are never blocked, anywhere", () => {
	assert.equal(
		guard({ method: "GET", url: `${origin}/sessions/demo-event` }),
		null,
	);
	assert.equal(guard({ method: "HEAD", url: `${origin}/api/v1/events` }), null);
	assert.equal(
		guard({ method: "GET", url: "https://fonts.example/x.woff2" }),
		null,
	);
});

test("writes to an event this run created are allowed", () => {
	assert.equal(
		guard({ method: "POST", url: `${origin}/submit/northbound-2026/form-1` }),
		null,
	);
});

test("writes to somebody else's event are blocked", () => {
	assert.match(
		guard({ method: "POST", url: `${origin}/submit/demo-event/form-1` }).reason,
		/did not create/,
	);
	assert.match(
		guard({ method: "POST", url: `${origin}/portals/acme-conf/p1/travel` })
			.reason,
		/did not create/,
	);
});

test("the run's own signup, login and admin writes are allowed", () => {
	for (const path of ["/signup", "/login", "/onboarding", "/admin/events/new"])
		assert.equal(
			guard({ method: "POST", url: `${origin}${path}` }),
			null,
			path,
		);
});

test("the public API and embeds are never written through", () => {
	assert.match(
		guard({ method: "POST", url: `${origin}/api/v1/events` }).reason,
		/public API/,
	);
	assert.match(
		guard({ method: "DELETE", url: `${origin}/embed/abc123` }).reason,
		/embed/,
	);
});

test("a browse-only journey cannot write at all", () => {
	assert.match(
		guard({ method: "POST", url: `${origin}/signup`, readOnly: true }).reason,
		/browse-only/,
	);
	assert.equal(
		guard({
			method: "GET",
			url: `${origin}/speakers/demo-event`,
			readOnly: true,
		}),
		null,
	);
});

test("writes off the product under review are blocked", () => {
	assert.match(
		guard({ method: "POST", url: "https://example.com/collect" }).reason,
		/not the product under review/,
	);
	assert.match(
		guard({ method: "POST", url: "not a url" }).reason,
		/unparseable/,
	);
});

test("analytics beacons are dropped quietly, not reported as guard hits", () => {
	const beacon = guard({ method: "POST", url: `${origin}/cdn-cgi/rum?` });
	assert.equal(beacon.quiet, true);
	assert.equal(
		guard({ method: "POST", url: `${origin}/cdn-cgi/rum?`, readOnly: true })
			.quiet,
		true,
	);
	assert.notEqual(
		guard({ method: "POST", url: `${origin}/signup`, readOnly: true }).quiet,
		true,
	);
});
