import { asc, count, eq, sql } from "drizzle-orm";
import { data, Form, redirect, useFetcher } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { PIPELINE_STAGE } from "~/db/constants";
import { pipelineCards } from "~/db/schema";
import { PipelineCardTile, PipelineColumn } from "~/components/pipeline-card";
import {
	enrollInPipeline,
	movePipelineCard,
	resolveCrmOrg,
} from "~/domain/crm";
import { normalizeEmail, requireAdmin } from "~/lib/auth";
import {
	isPipelineStage,
	PIPELINE_STAGE_LABEL,
	type PipelineStage,
} from "~/lib/pipeline";
import { createTimings, track } from "~/lib/track";
import {
	Button,
	ButtonLink,
	EmptyState,
	ErrorText,
	Field,
	Input,
	Panel,
	Select,
	Textarea,
} from "~/ui";
import type { Route } from "./+types/admin.crm.pipeline";

const PER_COLUMN = 50;

const Enroll = z.object({
	email: z.email("Enter the contact's email address."),
	stage: z.enum(PIPELINE_STAGE),
	score: z.union([
		z.literal("").transform(() => null),
		z.coerce
			.number()
			.int("Score must be a whole number.")
			.min(0, "Score runs 0–100.")
			.max(100, "Score runs 0–100."),
	]),
	rationale: z
		.string()
		.trim()
		.max(2000, "Keep the rationale under 2,000 characters.")
		.transform((v) => v || null),
});

const Move = z.object({
	cardId: z.string().min(1),
	stage: z.enum(PIPELINE_STAGE),
});

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const timings = createTimings();
	const org = await timings.time("org", () => resolveCrmOrg(env, db, user));
	if (!org) throw redirect("/admin/crm");
	// Bounded board: the oldest PER_COLUMN cards per stage (row_number over a
	// stage partition), with true per-stage totals for the honest "+N more" note.
	const ranked = db
		.select({
			id: pipelineCards.id,
			email: pipelineCards.email,
			firstName: pipelineCards.firstName,
			lastName: pipelineCards.lastName,
			companyName: pipelineCards.companyName,
			stage: pipelineCards.stage,
			score: pipelineCards.score,
			rank: sql<number>`row_number() over (
				partition by ${pipelineCards.stage}
				order by ${pipelineCards.createdAt}, ${pipelineCards.id}
			)`.as("rank"),
		})
		.from(pipelineCards)
		.where(eq(pipelineCards.organizationId, org.id))
		.as("ranked");
	const [cards, stageTotals] = await timings.time("db", () =>
		Promise.all([
			db
				.select({
					id: ranked.id,
					email: ranked.email,
					firstName: ranked.firstName,
					lastName: ranked.lastName,
					companyName: ranked.companyName,
					stage: ranked.stage,
					score: ranked.score,
				})
				.from(ranked)
				.where(sql`${ranked.rank} <= ${PER_COLUMN}`)
				.orderBy(asc(ranked.rank)),
			db
				.select({ stage: pipelineCards.stage, n: count() })
				.from(pipelineCards)
				.where(eq(pipelineCards.organizationId, org.id))
				.groupBy(pipelineCards.stage),
		]),
	);
	const byStage = new Map<PipelineStage, typeof cards>(
		PIPELINE_STAGE.map((s) => [s, []]),
	);
	for (const card of cards) byStage.get(card.stage)?.push(card);
	const totals = new Map(stageTotals.map((r) => [r.stage, r.n]));
	return data(
		{
			columns: PIPELINE_STAGE.map((stage) => ({
				stage,
				total: totals.get(stage) ?? 0,
				cards: byStage.get(stage) ?? [],
			})),
			total: stageTotals.reduce((sum, r) => sum + r.n, 0),
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not re-run the layout loader.
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const org = await resolveCrmOrg(env, db, user);
	if (!org) {
		return { formError: "No organization is configured yet." };
	}
	const actor = { id: user.id, name: user.name ?? user.email };
	const form = await request.formData();
	const timings = createTimings();

	if (form.get("intent") === "move") {
		const parsed = Move.safeParse({
			cardId: form.get("cardId"),
			stage: form.get("stage"),
		});
		if (!parsed.success) {
			return { formError: parsed.error.issues[0]?.message ?? "Invalid move." };
		}
		const result = await timings.time("db", () =>
			movePipelineCard(
				db,
				org.id,
				parsed.data.cardId,
				parsed.data.stage,
				actor,
			),
		);
		if (!result.ok) return { formError: result.reason };
		track("crm.card_moved", {
			orgId: org.id,
			cardId: parsed.data.cardId,
			stage: parsed.data.stage,
		});
		return data(
			{ notice: `Moved to ${PIPELINE_STAGE_LABEL[parsed.data.stage]}.` },
			{ headers: { "Server-Timing": timings.header() } },
		);
	}

	const parsed = Enroll.safeParse({
		email: form.get("email"),
		stage: form.get("stage"),
		score: form.get("score") ?? "",
		rationale: form.get("rationale") ?? "",
	});
	if (!parsed.success) {
		return {
			fieldErrors: z.flattenError(parsed.error).fieldErrors,
		};
	}
	const result = await timings.time("db", () =>
		enrollInPipeline(db, org.id, {
			email: normalizeEmail(parsed.data.email),
			stage: parsed.data.stage,
			score: parsed.data.score,
			rationale: parsed.data.rationale,
			actor,
		}),
	);
	if (!result.ok) {
		const fieldErrors: ReturnType<
			typeof z.flattenError<z.infer<typeof Enroll>>
		>["fieldErrors"] = { email: [result.reason] };
		return data(
			{ fieldErrors },
			{ headers: { "Server-Timing": timings.header() } },
		);
	}
	track("crm.enrolled", { orgId: org.id, cardId: result.cardId });
	// Stay on the board: the revalidated loader shows the new card in place.
	return data(
		{
			notice: `Enrolled at ${PIPELINE_STAGE_LABEL[parsed.data.stage]} — the card is on the board below.`,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

function MoveControl({
	cardId,
	name,
	stage,
}: {
	cardId: string;
	name: string;
	stage: PipelineStage;
}) {
	const fetcher = useFetcher();
	const pending = fetcher.formData?.get("stage");
	const shown = isPipelineStage(pending) ? pending : stage;
	const inlineError =
		!pending &&
		fetcher.data &&
		typeof fetcher.data === "object" &&
		"formError" in fetcher.data &&
		typeof fetcher.data.formError === "string"
			? fetcher.data.formError
			: undefined;
	return (
		<fetcher.Form method="post" className="flex flex-col gap-1">
			<Input type="hidden" name="intent" value="move" />
			<Input type="hidden" name="cardId" value={cardId} />
			<Select
				key={stage}
				name="stage"
				defaultValue={shown}
				aria-label={`Move ${name} to another stage`}
				onChange={(e) => fetcher.submit(e.currentTarget.form)}
			>
				{PIPELINE_STAGE.map((s) => (
					<option key={s} value={s}>
						{PIPELINE_STAGE_LABEL[s]}
					</option>
				))}
			</Select>
			{inlineError && <ErrorText>{inlineError}</ErrorText>}
		</fetcher.Form>
	);
}

export default function CrmPipeline({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { columns, total } = loaderData;
	const fieldErrors =
		actionData && "fieldErrors" in actionData
			? actionData.fieldErrors
			: undefined;
	const formError =
		actionData && "formError" in actionData ? actionData.formError : undefined;
	const notice =
		actionData && "notice" in actionData ? actionData.notice : undefined;

	return (
		<div className="flex flex-col gap-5">
			<Panel>
				<Form method="post" className="flex flex-wrap items-end gap-3">
					<Field label="Contact email" error={fieldErrors?.email?.[0]}>
						<Input
							name="email"
							type="email"
							placeholder="A directory contact's email"
							invalid={Boolean(fieldErrors?.email?.[0])}
						/>
					</Field>
					<Field label="Starting stage" error={fieldErrors?.stage?.[0]}>
						<Select name="stage" defaultValue="identified">
							{PIPELINE_STAGE.map((s) => (
								<option key={s} value={s}>
									{PIPELINE_STAGE_LABEL[s]}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Score (0–100)" error={fieldErrors?.score?.[0]}>
						<Input
							name="score"
							inputMode="numeric"
							placeholder="Optional"
							invalid={Boolean(fieldErrors?.score?.[0])}
						/>
					</Field>
					<Field label="Rationale" error={fieldErrors?.rationale?.[0]}>
						<Textarea
							name="rationale"
							rows={1}
							placeholder="Why this prospect (optional)"
						/>
					</Field>
					<Button type="submit" name="intent" value="enroll" icon="plus">
						Enroll
					</Button>
					{formError && <ErrorText>{formError}</ErrorText>}
				</Form>
				{notice && <p className="pt-3">{notice}</p>}
			</Panel>

			{total === 0 ? (
				<Panel>
					<EmptyState
						icon="clipboard"
						title="No prospects in the pipeline yet"
						body="Enroll a directory contact above — or select people in the Directory tab — to start tracking sourcing from research through confirmed."
						action={
							<ButtonLink to="/admin/crm/directory" icon="users">
								Open the directory
							</ButtonLink>
						}
					/>
				</Panel>
			) : (
				<div className="overflow-x-auto pb-2">
					<div className="flex items-start gap-3">
						{columns.map((col) => (
							<PipelineColumn
								key={col.stage}
								label={PIPELINE_STAGE_LABEL[col.stage]}
								count={col.total}
								truncated={col.total - col.cards.length}
							>
								{col.cards.map((card) => {
									const name = `${card.firstName} ${card.lastName}`.trim();
									return (
										<PipelineCardTile
											key={card.id}
											to={`/admin/crm/pipeline/${card.id}`}
											name={name}
											subtitle={card.companyName || card.email}
											score={card.score}
											control={
												<MoveControl
													cardId={card.id}
													name={name}
													stage={card.stage}
												/>
											}
										/>
									);
								})}
							</PipelineColumn>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<Panel>
			<EmptyState
				icon="clipboard"
				title="Failed to load the pipeline"
				body="Something went wrong. Please refresh or try again."
			/>
		</Panel>
	);
}
