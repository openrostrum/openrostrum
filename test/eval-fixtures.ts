import { getDb } from "../app/db";
import {
	contacts,
	evaluationPlans,
	evaluationRounds,
	evaluations,
	events,
	organizations,
	participants,
	reviewerTracks,
	roundEvaluators,
	roundQuestions,
	submissionTracks,
	submissions,
	tracks,
	users,
} from "../app/db/schema";
import { createSession } from "../app/lib/auth";

/**
 * Shared review-lane fixture: three submissions, a reviewer covering ONE
 * track, an anonymized round whose scorecard has weighted questions
 * (Originality w2, Relevance w1, Recommendation dropdown, Comments text),
 * and exactly ONE assignment (s1) — so "queue = assigned set" stays
 * distinguishable from track routing (s1+s2 share the reviewer's track;
 * s3 does not).
 */
export async function seedEvalBase(
	env: Env,
	opts: { withPlan?: boolean } = {},
) {
	const withPlan = opts.withPlan ?? true;
	const db = getDb(env);
	await db.insert(organizations).values({ id: "org1", name: "Org" });
	await db.insert(events).values({
		id: "e1",
		organizationId: "org1",
		name: "DevFlow Conf",
		slug: "devflow",
	});
	await db.insert(tracks).values([
		{ id: "t_ai", eventId: "e1", name: "AI Engineering", color: "#0ea5e9" },
		{
			id: "t_dx",
			eventId: "e1",
			name: "Developer Experience",
			color: "#f59e0b",
		},
	]);
	await db.insert(users).values([
		{
			id: "u_admin",
			email: "jordan@test.co",
			passwordHash: "x",
			name: "Jordan Alvarez",
			role: "admin",
			activeEventId: "e1",
		},
		{
			id: "u_rev",
			email: "sam@test.co",
			passwordHash: "x",
			name: "Sam Whitfield",
			role: "reviewer",
		},
		{
			id: "u_speaker",
			email: "priya@test.co",
			passwordHash: "x",
			name: "Priya Raman",
			role: "speaker",
		},
	]);
	await db.insert(contacts).values([
		{
			id: "c_priya",
			eventId: "e1",
			userId: "u_speaker",
			email: "priya@test.co",
			firstName: "Priya",
			lastName: "Raman",
			companyName: "Latticework Systems",
		},
		{
			id: "c_marcus",
			eventId: "e1",
			email: "marcus@test.co",
			firstName: "Marcus",
			lastName: "Okafor",
			companyName: "Cloudreach Labs",
		},
	]);
	await db.insert(submissions).values([
		{
			id: "s1",
			eventId: "e1",
			title: "Taming 40-Minute CI",
			description: "<p>Incremental builds at monorepo scale.</p>",
			status: "pending",
			submitterId: "u_speaker",
		},
		{
			id: "s2",
			eventId: "e1",
			title: "Your AI Pair Programmer Is Lying to You",
			status: "pending",
		},
		{
			id: "s3",
			eventId: "e1",
			title: "Docs That Answer Back",
			status: "pending",
		},
	]);
	await db.insert(submissionTracks).values([
		{ submissionId: "s1", trackId: "t_ai" },
		{ submissionId: "s2", trackId: "t_ai" },
		{ submissionId: "s3", trackId: "t_dx" },
	]);
	await db.insert(participants).values([
		{
			id: "p_priya",
			submissionId: "s1",
			contactId: "c_priya",
			role: "speaker",
			isPrimary: true,
			position: 0,
		},
		{
			id: "p_marcus",
			submissionId: "s1",
			contactId: "c_marcus",
			role: "secondary",
			position: 1,
		},
	]);
	await db
		.insert(reviewerTracks)
		.values([{ userId: "u_rev", trackId: "t_ai" }]);
	if (withPlan) {
		await db.insert(evaluationPlans).values({
			id: "plan1",
			eventId: "e1",
			name: "Program Review",
			instructions: "Score originality and relevance.",
			status: "open",
		});
		await db.insert(evaluationRounds).values({
			id: "r1",
			planId: "plan1",
			name: "Initial Review",
			position: 0,
			anonymized: true,
			opensAt: new Date("2026-08-01T00:00:00Z"),
			closesAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		});
		await db.insert(roundQuestions).values([
			{
				id: "q_orig",
				roundId: "r1",
				label: "Originality",
				type: "rating",
				config: { min: 1, max: 5 },
				weight: 2,
				required: true,
				position: 0,
			},
			{
				id: "q_rel",
				roundId: "r1",
				label: "Relevance",
				type: "rating",
				config: { min: 1, max: 5 },
				weight: 1,
				required: true,
				position: 1,
			},
			{
				id: "q_rec",
				roundId: "r1",
				label: "Recommendation",
				type: "dropdown",
				config: { options: ["Accept", "Maybe", "Reject"] },
				weight: 1,
				required: true,
				position: 2,
			},
			{
				id: "q_com",
				roundId: "r1",
				label: "Comments",
				type: "text",
				weight: 1,
				required: false,
				position: 3,
			},
		]);
		await db
			.insert(roundEvaluators)
			.values([{ roundId: "r1", userId: "u_rev" }]);
		await db
			.insert(evaluations)
			.values([
				{ id: "ev1", roundId: "r1", submissionId: "s1", evaluatorId: "u_rev" },
			]);
	}
	return { db };
}

/** Request authenticated as an existing seeded user. */
export async function sessionRequest(
	env: Env,
	userId: string,
	url: string,
	init?: RequestInit,
): Promise<Request> {
	const setCookie = await createSession(env, userId);
	const headers = new Headers(init?.headers);
	headers.set("Cookie", setCookie.split(";")[0] ?? "");
	return new Request(url, { ...init, headers });
}

export const CONTEXT_OF = (env: Env) => ({ cloudflare: { env, ctx: {} } });

/** Canonical sample round-1 review: Originality 4, Relevance 2, Accept. */
export function sampleScorecardBody(evaluationId: string): URLSearchParams {
	return new URLSearchParams([
		["intent", "save-eval"],
		["evaluationId", evaluationId],
		["q_q_orig", "4"],
		["q_q_rel", "2"],
		["q_q_rec", "Accept"],
		["q_q_com", "Strong practical content and a clear narrative arc."],
	]);
}
