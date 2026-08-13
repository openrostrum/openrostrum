import { env } from "cloudflare:test";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { roundQuestions } from "../app/db/schema";
import ReviewSubmission, {
	action as reviewAction,
	loader as reviewLoader,
} from "../app/routes/reviews.$id";
import {
	CONTEXT_OF,
	sampleScorecardBody,
	seedEvalBase,
	sessionRequest,
} from "./eval-fixtures";

const CONTEXT = CONTEXT_OF(env);

type LoaderFn = (args: unknown) => Promise<unknown>;
const call = async (fn: unknown, request: Request, id: string) =>
	(fn as LoaderFn)({
		context: CONTEXT,
		request,
		params: { id },
	});

async function renderReview(
	submissionId: string,
	actionData?: unknown,
): Promise<string> {
	const request = await sessionRequest(
		env,
		"u_rev",
		`http://localhost/reviews/${submissionId}`,
	);
	const result = (await call(reviewLoader, request, submissionId)) as {
		data: unknown;
	};
	const RouteComponent = ReviewSubmission as unknown as ComponentType<{
		loaderData: unknown;
		actionData?: unknown;
	}>;
	const RoutesStub = createRoutesStub([
		{
			path: "/reviews/:id",
			Component: () =>
				createElement(RouteComponent, {
					loaderData: result.data,
					actionData,
				}),
		},
	]);
	return renderToString(
		createElement(RoutesStub, {
			initialEntries: [`/reviews/${submissionId}`],
		}),
	);
}

describe("reviewer scorecard anchors", () => {
	it("renders organizer-authored labels at the point of scoring", async () => {
		const { db } = await seedEvalBase(env);
		await db
			.update(roundQuestions)
			.set({
				config: Object.assign(
					{ min: 1, max: 5 },
					{
						labels: {
							"1": "Not ready for the stage",
							"3": "Programmable as-is",
							"5": "Must-see keynote",
						},
					},
				),
			})
			.where(eq(roundQuestions.id, "q_orig"));

		const html = await renderReview("s1");
		expect(html).toContain("1 — Not ready for the stage");
		expect(html).toContain("3 — Programmable as-is");
		expect(html).toContain("5 — Must-see keynote");
		expect(html).toContain("Higher is better");
	});

	it("renders built-in anchors when the question config has no labels", async () => {
		await seedEvalBase(env);
		const html = await renderReview("s1");
		expect(html).toContain("1 — Weak — does not meet the bar");
		expect(html).toContain("3 — Meets the bar");
		expect(html).toContain("5 — Outstanding — a standout talk");
		expect(html).toContain("Higher is better");
	});

	it("shows the plan instructions where the reviewer scores", async () => {
		await seedEvalBase(env);
		const html = await renderReview("s1");
		expect(html).toContain("Reviewer instructions");
		expect(html).toContain("Score originality and relevance.");
	});

	it("says when a rating counts more than the others", async () => {
		await seedEvalBase(env);
		const html = await renderReview("s1");
		expect(html).toContain("counts 2× toward the score");
	});
});

describe("reviewer scorecard save confirmation", () => {
	it("shows one success confirmation after saving, not two", async () => {
		await seedEvalBase(env);
		const actionData = await call(
			reviewAction,
			await sessionRequest(env, "u_rev", "http://localhost/reviews/s1", {
				method: "POST",
				body: sampleScorecardBody("ev1"),
			}),
			"s1",
		);
		const html = await renderReview("s1", actionData);
		const submitted = (html.match(/Review submitted/g) ?? []).length;
		const saved = (html.match(/Review saved/g) ?? []).length;
		expect(submitted + saved).toBe(1);
	});
});
