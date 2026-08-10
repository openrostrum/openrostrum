import { and, asc, eq } from "drizzle-orm";
import { useState } from "react";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { CONTACT_STATUS, PIPELINE_STAGE } from "~/db/constants";
import { crmSegments, events } from "~/db/schema";
import { CONTACT_STATUS_TONE } from "~/components/contact-status";
import {
	addPersonToEvent,
	countDirectory,
	enrollInPipeline,
	queryDirectoryPage,
} from "~/domain/crm";
import { normalizeEmail, requireAdmin, resolveActiveOrg } from "~/lib/auth";
import {
	directoryFiltersFromParams,
	directoryUrl,
	hasDirectoryFilters,
} from "~/lib/crm-filters";
import { errorMessage, isUniqueViolation } from "~/lib/errors";
import { PIPELINE_STAGE_LABEL } from "~/lib/pipeline";
import { createTimings, track } from "~/lib/track";
import {
	Avatar,
	Button,
	ButtonLink,
	EmptyRow,
	EmptyState,
	ErrorText,
	Field,
	Input,
	Panel,
	SearchInput,
	Select,
	StatusBadge,
	Table,
	TableFooter,
	TBody,
	Td,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.crm.directory";

const PER_PAGE = 50;

const AddToEvent = z.object({
	emails: z.array(z.string().min(1)).min(1, "Select at least one person."),
	targetEventId: z.string().min(1, "Pick an event."),
});

const Enroll = z.object({
	emails: z.array(z.string().min(1)).min(1, "Select at least one person."),
	stage: z.enum(PIPELINE_STAGE),
});

const SaveSegment = z.object({
	name: z
		.string()
		.trim()
		.min(1, "Name the segment before saving.")
		.max(120, "Segment names cap at 120 characters."),
});

type ActionData = { formError?: string; notice?: string };

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const timings = createTimings();
	const org = await timings.time("org", () => resolveActiveOrg(env, user));
	if (!org) throw redirect("/admin/crm");
	const url = new URL(request.url);
	const filters = directoryFiltersFromParams(url.searchParams);
	const segmentId = url.searchParams.get("segment");

	const { people, total, page, orgEvents, segment } = await timings.time(
		"db",
		async () => {
			const totalPeople = await countDirectory(db, org.id, filters);
			const lastPage = Math.max(1, Math.ceil(totalPeople / PER_PAGE));
			const currentPage = Math.min(
				Math.max(1, Number(url.searchParams.get("page")) || 1),
				lastPage,
			);
			const [pagePeople, eventRows, segmentRow] = await Promise.all([
				totalPeople === 0
					? []
					: queryDirectoryPage(db, org.id, filters, currentPage, PER_PAGE),
				db
					.select({ id: events.id, name: events.name })
					.from(events)
					.where(eq(events.organizationId, org.id))
					.orderBy(asc(events.createdAt)),
				segmentId
					? db
							.select({ id: crmSegments.id, name: crmSegments.name })
							.from(crmSegments)
							.where(
								and(
									eq(crmSegments.id, segmentId),
									eq(crmSegments.organizationId, org.id),
								),
							)
							.limit(1)
							.then((rows) => rows[0] ?? null)
					: null,
			]);
			return {
				people: pagePeople,
				total: totalPeople,
				page: currentPage,
				orgEvents: eventRows,
				segment: segmentRow,
			};
		},
	);
	return data(
		{
			people,
			total,
			page,
			perPage: PER_PAGE,
			filters,
			events: orgEvents,
			segment,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not re-run the layout loader.
	const user = await requireAdmin(env, request);
	const db = getDb(env);
	const org = await resolveActiveOrg(env, user);
	if (!org) {
		return { formError: "No organization is configured yet." };
	}
	const form = await request.formData();
	const intent = form.get("intent");
	if (intent === "add-to-event") {
		return addToEventAction(db, org.id, form);
	}
	if (intent === "enroll") {
		return enrollAction(db, org.id, user, form);
	}
	if (intent === "save-segment") {
		return saveSegmentAction(db, org.id, user.id, form, request.url);
	}
	return { formError: "Unknown action." };
}

async function addToEventAction(
	db: ReturnType<typeof getDb>,
	orgId: string,
	form: FormData,
): Promise<ReturnType<typeof data<ActionData>> | ActionData> {
	const parsed = AddToEvent.safeParse({
		emails: form.getAll("emails"),
		targetEventId: form.get("targetEventId"),
	});
	if (!parsed.success) {
		return { formError: parsed.error.issues[0]?.message ?? "Invalid request." };
	}
	const timings = createTimings();
	const result = await timings.time("db", async () => {
		let added = 0;
		let already = 0;
		let missing = 0;
		let eventName = "";
		for (const raw of new Set(parsed.data.emails.map(normalizeEmail))) {
			const outcome = await addPersonToEvent(
				db,
				orgId,
				raw,
				parsed.data.targetEventId,
			);
			if (outcome.outcome === "foreign") {
				return {
					formError: "That event does not belong to your organization.",
				};
			}
			eventName = outcome.eventName;
			if (outcome.outcome === "added") added += 1;
			else if (outcome.outcome === "already") already += 1;
			else missing += 1;
		}
		track("crm.added_to_event", {
			orgId,
			eventId: parsed.data.targetEventId,
			added,
			already,
		});
		const parts = [
			`${added} added to ${eventName}`,
			already ? `${already} already there` : null,
			missing ? `${missing} not found in the directory` : null,
		].filter(Boolean);
		return { notice: parts.join(" · ") };
	});
	return data(result, { headers: { "Server-Timing": timings.header() } });
}

async function enrollAction(
	db: ReturnType<typeof getDb>,
	orgId: string,
	user: { id: string; name: string | null; email: string },
	form: FormData,
): Promise<ReturnType<typeof data<ActionData>> | ActionData> {
	const parsed = Enroll.safeParse({
		emails: form.getAll("emails"),
		stage: form.get("stage"),
	});
	if (!parsed.success) {
		return { formError: parsed.error.issues[0]?.message ?? "Invalid request." };
	}
	const timings = createTimings();
	const actor = { id: user.id, name: user.name ?? user.email };
	const result = await timings.time("db", async () => {
		let enrolled = 0;
		let alreadyIn = 0;
		let missing = 0;
		for (const raw of new Set(parsed.data.emails.map(normalizeEmail))) {
			const outcome = await enrollInPipeline(db, orgId, {
				email: raw,
				stage: parsed.data.stage,
				score: null,
				rationale: null,
				actor,
			});
			if (outcome.ok) enrolled += 1;
			else if (outcome.code === "duplicate") alreadyIn += 1;
			else missing += 1;
		}
		track("crm.enrolled", { orgId, enrolled, stage: parsed.data.stage });
		const parts = [
			`${enrolled} enrolled at ${PIPELINE_STAGE_LABEL[parsed.data.stage]}`,
			alreadyIn ? `${alreadyIn} already in the pipeline` : null,
			missing ? `${missing} not found in the directory` : null,
		].filter(Boolean);
		return { notice: parts.join(" · ") };
	});
	return data(result, { headers: { "Server-Timing": timings.header() } });
}

async function saveSegmentAction(
	db: ReturnType<typeof getDb>,
	orgId: string,
	userId: string,
	form: FormData,
	requestUrl: string,
) {
	const parsed = SaveSegment.safeParse({ name: form.get("name") });
	if (!parsed.success) {
		return { formError: parsed.error.issues[0]?.message ?? "Invalid request." };
	}
	// The saved filters are the ones the admin is LOOKING at — read them from
	// the URL the form posted to, the same params the loader filtered by.
	const filters = directoryFiltersFromParams(new URL(requestUrl).searchParams);
	if (!hasDirectoryFilters(filters)) {
		return { formError: "Apply at least one filter before saving a segment." };
	}
	try {
		const [created] = await db
			.insert(crmSegments)
			.values({
				organizationId: orgId,
				name: parsed.data.name,
				createdById: userId,
				filters,
			})
			.returning({ id: crmSegments.id });
		track("crm.segment_saved", { orgId, segmentId: created?.id });
	} catch (error) {
		if (isUniqueViolation(error)) {
			return { formError: "A segment with this name already exists." };
		}
		track("crm.segment_save_failed", { orgId, error: errorMessage(error) });
		return { formError: "Could not save the segment — please try again." };
	}
	return redirect("/admin/crm/segments");
}

export default function CrmDirectory({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { people, total, page, perPage, filters, events, segment } = loaderData;
	const busy = useNavigation().state !== "idle";
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const toggleSelected = (email: string, checked: boolean) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (checked) next.add(email);
			else next.delete(email);
			return next;
		});
	};
	const filtered = hasDirectoryFilters(filters);
	const from = total === 0 ? 0 : (page - 1) * perPage + 1;
	const to = Math.min(page * perPage, total);
	const notice =
		actionData && "notice" in actionData ? actionData.notice : undefined;
	const formError =
		actionData && "formError" in actionData ? actionData.formError : undefined;

	return (
		<div className="flex flex-col gap-5">
			<Panel>
				<Form method="get" className="flex flex-col gap-3">
					<div className="flex flex-wrap items-end gap-3">
						<Field label="Search">
							<SearchInput
								name="q"
								defaultValue={filters.q ?? ""}
								placeholder="Name, email, company…"
								aria-label="Search people"
							/>
						</Field>
						<Field label="Company">
							<Input name="company" defaultValue={filters.company ?? ""} />
						</Field>
						<Field label="Job title">
							<Input name="title" defaultValue={filters.title ?? ""} />
						</Field>
						<Field label="Event">
							<Select name="event" defaultValue={filters.eventId ?? ""}>
								<option value="">Any event</option>
								{events.map((e) => (
									<option key={e.id} value={e.id}>
										{e.name}
									</option>
								))}
							</Select>
						</Field>
						<Field label="Status">
							<Select name="status" defaultValue={filters.status ?? ""}>
								<option value="">Any status</option>
								{CONTACT_STATUS.map((s) => (
									<option key={s} value={s}>
										{s}
									</option>
								))}
							</Select>
						</Field>
						<Button type="submit" variant="ghost" icon="filter">
							Apply filters
						</Button>
						{filtered && (
							<ButtonLink to="/admin/crm/directory" variant="ghost">
								Clear
							</ButtonLink>
						)}
					</div>
				</Form>
				{segment && (
					<p className="pt-3">
						Viewing segment “{segment.name}” — its filters are applied above.
					</p>
				)}
				{filtered && !segment && (
					<Form
						method="post"
						action={directoryUrl(filters, page)}
						className="flex flex-wrap items-end gap-3 pt-3"
					>
						<Field label="Save this filter set as a segment">
							<Input name="name" placeholder="e.g. AI Experts" />
						</Field>
						<Button
							type="submit"
							name="intent"
							value="save-segment"
							icon="star"
						>
							Save segment
						</Button>
					</Form>
				)}
			</Panel>

			<Panel>
				<Form
					method="post"
					id="crm-bulk"
					className="flex flex-wrap items-end gap-3"
				>
					<Field
						label={`${selected.size} selected ${selected.size === 1 ? "person" : "people"}`}
					>
						<Select name="targetEventId" defaultValue="">
							<option value="" disabled>
								Pick an event…
							</option>
							{events.map((e) => (
								<option key={e.id} value={e.id}>
									{e.name}
								</option>
							))}
						</Select>
					</Field>
					<Button
						type="submit"
						name="intent"
						value="add-to-event"
						icon="plus"
						disabled={busy || selected.size === 0}
					>
						Add to event
					</Button>
					<Field label="Pipeline stage">
						<Select name="stage" defaultValue="identified">
							{PIPELINE_STAGE.map((s) => (
								<option key={s} value={s}>
									{PIPELINE_STAGE_LABEL[s]}
								</option>
							))}
						</Select>
					</Field>
					<Button
						type="submit"
						name="intent"
						value="enroll"
						variant="ghost"
						icon="clipboard"
						disabled={busy || selected.size === 0}
					>
						Enroll in pipeline
					</Button>
				</Form>
				{notice && <p className="pt-3">{notice}</p>}
				{formError && <ErrorText>{formError}</ErrorText>}
			</Panel>

			<Table>
				<THead>
					<Th> </Th>
					<Th>Name</Th>
					<Th>Email</Th>
					<Th>Title · Company</Th>
					<Th>Events</Th>
					<Th />
				</THead>
				<TBody>
					{people.map((p) => {
						const name = `${p.firstName} ${p.lastName}`.trim();
						const profile = `/admin/crm/person/${encodeURIComponent(p.email)}`;
						return (
							<Tr key={p.email} selected={selected.has(p.email)}>
								<Td>
									<Input
										type="checkbox"
										name="emails"
										value={p.email}
										form="crm-bulk"
										aria-label={`Select ${name}`}
										checked={selected.has(p.email)}
										onChange={(e) =>
											toggleSelected(p.email, e.currentTarget.checked)
										}
									/>
								</Td>
								<Td kind="strong">
									<div className="flex items-center gap-2">
										<Link to={profile} className="flex items-center gap-2">
											<Avatar name={name} />
											{name}
										</Link>
										{p.possibleDuplicate && (
											<Link
												to={profile}
												aria-label={`${name} has a possible duplicate`}
											>
												<StatusBadge tone="caution">
													possible duplicate
												</StatusBadge>
											</Link>
										)}
									</div>
								</Td>
								<Td kind="mono">{p.email}</Td>
								<Td>
									{[p.jobTitle, p.companyName].filter(Boolean).join(" · ") ||
										"—"}
								</Td>
								<Td>
									<div className="flex flex-col gap-1">
										{p.appearances.slice(0, 3).map((a) => (
											<span
												key={a.contactId}
												className="flex items-center gap-2"
											>
												{a.eventName}
												<StatusBadge tone={CONTACT_STATUS_TONE[a.status]}>
													{a.status}
												</StatusBadge>
											</span>
										))}
										{p.appearances.length > 3 && (
											<span>+{p.appearances.length - 3} more</span>
										)}
									</div>
								</Td>
								<Td>
									<ButtonLink to={profile} variant="ghost">
										Open
									</ButtonLink>
								</Td>
							</Tr>
						);
					})}
					{people.length === 0 && filtered && (
						<EmptyRow colSpan={6}>
							No people match these filters — clear them to see everyone in your
							organization.
						</EmptyRow>
					)}
				</TBody>
			</Table>
			{people.length === 0 && !filtered && (
				<Panel>
					<EmptyState
						icon="users"
						title="No people in your organization yet"
						body="The directory unions every event's contacts into one list per person. Add speakers to an event — by hand, from submissions, or with a CSV import — and they appear here."
						action={
							<ButtonLink to="/admin/contacts" icon="plus">
								Go to the event roster
							</ButtonLink>
						}
					/>
				</Panel>
			)}

			{total > 0 && (
				<TableFooter>
					<span>
						{from}–{to} of {total} people
					</span>
					<span className="ml-auto flex items-center gap-2">
						{page > 1 && (
							<ButtonLink to={directoryUrl(filters, page - 1)} variant="ghost">
								Previous
							</ButtonLink>
						)}
						{to < total && (
							<ButtonLink to={directoryUrl(filters, page + 1)} variant="ghost">
								Next
							</ButtonLink>
						)}
					</span>
				</TableFooter>
			)}
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<Panel>
			<EmptyState
				icon="users"
				title="Failed to load the directory"
				body="Something went wrong. Please refresh or try again."
			/>
		</Panel>
	);
}
