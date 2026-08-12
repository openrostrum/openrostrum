import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";

const VIEWPORTS = {
	desktop: { viewport: { width: 1280, height: 800 } },
	mobile: {
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
		deviceScaleFactor: 2,
		userAgent:
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
	},
};

// Public surfaces whose first path segment names an event. A write here reaches
// whichever organization owns that event, so it is allowed only for events this
// run created itself.
const EVENT_SCOPED = new Set([
	"submit",
	"portals",
	"sessions",
	"speakers",
	"schedule",
	"agenda",
	"itinerary",
	"gallery",
	"feeds",
]);

const MAX_INDEX_ENTRIES = 120;
const MAX_DIGEST_CHARS = 3000;
const SETTLE_MS = 450;

export function isBlockedRequest({
	method,
	url,
	origin,
	ownedSlugs,
	readOnly,
}) {
	if (method === "GET" || method === "HEAD") return null;
	let target;
	try {
		target = new URL(url);
	} catch {
		return { reason: `unparseable ${method} target` };
	}
	if (target.origin !== origin)
		return {
			reason: `${method} to ${target.origin}, which is not the product under review`,
		};
	// Cloudflare's analytics beacon, not the product. Dropping it keeps a synthetic
	// persona out of the owner's real traffic numbers, and it is not worth a word
	// to the critic or a line in the report.
	if (target.pathname.startsWith("/cdn-cgi/"))
		return { reason: `${method} to an edge analytics beacon`, quiet: true };
	if (readOnly)
		return {
			reason: `${method} to ${target.pathname}, and this journey is browse-only`,
		};
	if (target.pathname.startsWith("/api/") || target.pathname === "/api")
		return {
			reason: `${method} to the public API, which this harness never writes through`,
		};
	const [, head, slug] = target.pathname.split("/");
	if (head === "embed")
		return {
			reason: `${method} to an embed route, which this harness never writes through`,
		};
	if (EVENT_SCOPED.has(head) && !ownedSlugs.has(slug))
		return {
			reason: `${method} to event "${slug}", which this run did not create`,
		};
	return null;
}

const INDEX_SCRIPT = `(() => {
	const SELECTOR = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"], [contenteditable="true"]';
	for (const stale of document.querySelectorAll("[data-jc-ref]"))
		stale.removeAttribute("data-jc-ref");
	const entries = [];
	let n = 0;
	for (const el of document.querySelectorAll(SELECTOR)) {
		const rect = el.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) continue;
		const style = getComputedStyle(el);
		if (style.visibility === "hidden" || style.opacity === "0") continue;
		const ref = "e" + ++n;
		el.setAttribute("data-jc-ref", ref);
		const label =
			el.getAttribute("aria-label") ||
			(el.labels && el.labels[0] ? el.labels[0].innerText : "") ||
			(el.innerText || "").trim() ||
			el.getAttribute("placeholder") ||
			el.getAttribute("title") ||
			el.getAttribute("name") ||
			"";
		const role =
			el.getAttribute("role") ||
			el.tagName.toLowerCase() + (el.type ? "[" + el.type + "]" : "");
		entries.push({
			ref,
			role,
			label: label.replace(/\\s+/g, " ").trim().slice(0, 90),
			value: (el.value || "").toString().slice(0, 60) || undefined,
			required: el.required || undefined,
			disabled: el.disabled || undefined,
			checked: el.checked || undefined,
			href: el.getAttribute("href") || undefined,
			belowFold: rect.top > window.innerHeight ? true : undefined,
		});
	}
	return {
		entries,
		text: (document.body.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim(),
		scrollY: Math.round(window.scrollY),
		scrollHeight: Math.round(document.documentElement.scrollHeight),
	};
})()`;

function describe(entry) {
	const flags = [
		entry.required && "required",
		entry.disabled && "disabled",
		entry.checked && "checked",
		entry.belowFold && "below fold",
	].filter(Boolean);
	const value = entry.value ? ` value="${entry.value}"` : "";
	const href = entry.href ? ` → ${entry.href}` : "";
	return `${entry.ref} ${entry.role} "${entry.label}"${value}${href}${flags.length ? ` (${flags.join(", ")})` : ""}`;
}

function slugify(text) {
	return (
		String(text ?? "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 40) || "step"
	);
}

export async function createSession({
	browser,
	origin,
	journey,
	shotDir,
	limits,
	ownedSlugs,
}) {
	const context = await browser.newContext({
		...VIEWPORTS[journey.viewport ?? "desktop"],
		baseURL: origin,
		locale: "en-US",
		timezoneId: "America/Los_Angeles",
	});
	const readOnly = Boolean(journey.readOnly);
	const blocked = [];
	let reportedBlocks = 0;

	await context.route("**/*", async (route, request) => {
		const block = isBlockedRequest({
			method: request.method(),
			url: request.url(),
			origin,
			ownedSlugs,
			readOnly,
		});
		if (!block) return route.continue();
		if (!block.quiet)
			blocked.push({
				url: request.url(),
				method: request.method(),
				reason: block.reason,
			});
		await route.abort("blockedbyclient");
	});

	const page = await context.newPage();
	page.setDefaultTimeout(20_000);
	page.setDefaultNavigationTimeout(30_000);
	await mkdir(shotDir, { recursive: true });

	const shots = [];
	let looks = 0;

	function guardNote() {
		if (blocked.length === reportedBlocks) return "";
		const fresh = blocked.slice(reportedBlocks);
		reportedBlocks = blocked.length;
		return `\n\nSAFETY GUARD: ${fresh.length} request(s) were blocked by this harness, not by the product — ${fresh.map((entry) => entry.reason).join("; ")}. Anything that failed just now may be the guard, not a defect. Do not report it as one.`;
	}

	async function settle() {
		await page
			.waitForLoadState("domcontentloaded")
			.catch(() => undefined)
			.then(() => page.waitForTimeout(SETTLE_MS));
	}

	async function snapshot() {
		return page.evaluate(INDEX_SCRIPT).catch(() => ({
			entries: [],
			text: "",
			scrollY: 0,
			scrollHeight: 0,
		}));
	}

	async function locate(ref) {
		const locator = page.locator(`[data-jc-ref="${ref}"]`);
		if ((await locator.count()) === 0)
			throw new Error(
				`${ref} is not on the page any more — the page changed since your last look. Call look and use a fresh ref.`,
			);
		return locator.first();
	}

	function actResult(text) {
		return {
			content: [{ type: "text", text: text + guardNote() }],
			details: { url: page.url() },
		};
	}

	async function afterAction(what) {
		await settle();
		const state = await snapshot();
		return actResult(
			`${what}\nurl: ${page.url()}\ntitle: ${await page.title().catch(() => "")}\nvisible text (call look to see the page):\n${state.text.slice(0, 800)}`,
		);
	}

	const tools = [
		{
			name: "look",
			label: "look",
			description:
				"Take a screenshot of what is on screen right now and get the interactive elements on it. Every finding must cite a screenshot from this tool.",
			parameters: Type.Object({
				reason: Type.String({
					description: "What you are about to judge, in a few words.",
				}),
				full_page: Type.Optional(Type.Boolean()),
			}),
			execute: async (_id, params) => {
				if (looks >= limits.maxLooks)
					throw new Error(
						"screenshot budget exhausted for this journey — finish and report what you have",
					);
				const index = ++looks;
				const state = await snapshot();
				const buffer = await page.screenshot({
					type: "jpeg",
					quality: 62,
					fullPage: Boolean(params.full_page),
					scale: "css",
				});
				const id = `shot-${String(index).padStart(2, "0")}`;
				const file = `${id}-${slugify(params.reason)}.jpg`;
				await writeFile(join(shotDir, file), buffer);
				shots.push({
					id,
					file,
					url: page.url(),
					reason: params.reason ?? "",
				});
				const entries = state.entries.slice(0, MAX_INDEX_ENTRIES);
				const truncated =
					state.entries.length > entries.length
						? `\n… ${state.entries.length - entries.length} more interactive elements not listed`
						: "";
				const text =
					state.text.length > MAX_DIGEST_CHARS
						? `${state.text.slice(0, MAX_DIGEST_CHARS)}\n… text truncated`
						: state.text;
				return {
					content: [
						{
							type: "image",
							data: buffer.toString("base64"),
							mimeType: "image/jpeg",
						},
						{
							type: "text",
							text: `screenshot: ${id}\nurl: ${page.url()}\ntitle: ${await page.title().catch(() => "")}\nscroll: ${state.scrollY} of ${state.scrollHeight}px${params.full_page ? " (full page capture)" : ""}\n\ninteractive elements:\n${entries.map(describe).join("\n") || "(none)"}${truncated}\n\nvisible text:\n${text}${guardNote()}`,
						},
					],
					details: { shot: id, url: page.url() },
				};
			},
		},
		{
			name: "open",
			label: "open",
			description:
				"Go to a URL or path on the product. Use this only where the person you are would plausibly arrive; do not guess at internal paths.",
			parameters: Type.Object({ url: Type.String() }),
			execute: async (_id, params) => {
				await page.goto(params.url, { waitUntil: "domcontentloaded" });
				return afterAction(`opened ${params.url}`);
			},
		},
		{
			name: "click",
			label: "click",
			description: "Click an element by the ref from your last look.",
			parameters: Type.Object({ ref: Type.String() }),
			execute: async (_id, params) => {
				const before = page.url();
				await (await locate(params.ref)).click();
				return afterAction(
					`clicked ${params.ref}${page.url() === before ? "" : " (navigated)"}`,
				);
			},
		},
		{
			name: "fill",
			label: "fill",
			description:
				"Replace the contents of a text field by ref. Type what the person you are would actually have to hand.",
			parameters: Type.Object({ ref: Type.String(), text: Type.String() }),
			execute: async (_id, params) => {
				await (await locate(params.ref)).fill(params.text);
				return actResult(`filled ${params.ref}`);
			},
		},
		{
			name: "choose",
			label: "choose",
			description:
				"Pick an option in a select by ref, by visible label or value.",
			parameters: Type.Object({ ref: Type.String(), option: Type.String() }),
			execute: async (_id, params) => {
				const locator = await locate(params.ref);
				const selected = await locator
					.selectOption({ label: params.option })
					.catch(() => locator.selectOption(params.option));
				return afterAction(
					`chose ${JSON.stringify(selected)} in ${params.ref}`,
				);
			},
		},
		{
			name: "press",
			label: "press",
			description:
				"Press a key such as Enter, Tab or Escape, optionally focused on a ref first.",
			parameters: Type.Object({
				key: Type.String(),
				ref: Type.Optional(Type.String()),
			}),
			execute: async (_id, params) => {
				if (params.ref) await (await locate(params.ref)).press(params.key);
				else await page.keyboard.press(params.key);
				return afterAction(`pressed ${params.key}`);
			},
		},
		{
			name: "scroll",
			label: "scroll",
			description: "Scroll the page up, down, to the top, or to the bottom.",
			parameters: Type.Object({
				direction: Type.Union([
					Type.Literal("down"),
					Type.Literal("up"),
					Type.Literal("top"),
					Type.Literal("bottom"),
				]),
			}),
			execute: async (_id, params) => {
				await page.evaluate((direction) => {
					const step = Math.round(window.innerHeight * 0.85);
					const to =
						direction === "top"
							? 0
							: direction === "bottom"
								? document.documentElement.scrollHeight
								: window.scrollY + (direction === "down" ? step : -step);
					window.scrollTo({ top: to, behavior: "instant" });
				}, params.direction);
				await page.waitForTimeout(250);
				return actResult(`scrolled ${params.direction}`);
			},
		},
		{
			name: "back",
			label: "back",
			description: "Go back one page, exactly as the browser button would.",
			parameters: Type.Object({}),
			execute: async () => {
				await page.goBack().catch(() => undefined);
				return afterAction("went back");
			},
		},
		{
			name: "claim_event",
			label: "claim_event",
			description:
				"Declare the short web name of an event YOU created in this run. Until you do, this harness blocks writes to that event's public pages so it cannot touch a real customer's data.",
			parameters: Type.Object({ slug: Type.String() }),
			execute: async (_id, params) => {
				const slug = String(params.slug ?? "").trim();
				if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
					throw new Error(
						"slug must look like a url segment, e.g. my-event-2026",
					);
				ownedSlugs.add(slug);
				return actResult(`claimed "${slug}" as an event this run created`);
			},
		},
	];

	return {
		tools,
		page,
		shots,
		blocked,
		lookCount: () => looks,
		close: () => context.close().catch(() => undefined),
	};
}
