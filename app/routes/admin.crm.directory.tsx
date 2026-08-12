import { and, asc, desc, eq, sql } from "drizzle-orm";
import { useState } from "react";
import { data, Form, Link, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { CONTACT_STATUS, PIPELINE_STAGE } from "~/db/constants";
import {
	contacts,
	crmSegments,
	events,
	insertContactSchema,
} from "~/db/schema";
import { CONTACT_STATUS_TONE } from "~/components/contact-status";
import {
	addToEventNotice,
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
import { useBusy } from "~/lib/use-busy";
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

const BULK_MAX = 50; // one directory page — bounds per-request D1 work

const NewPerson = insertContactSchema
	.pick({
		firstName: true,
		lastName: true,
		email: true,
		jobTitle: true,
		companyName: true,
	})
	.extend({
		firstName: z.string().trim().min(1, "First name is required"),
		lastName: z.string().trim().min(1, "Last name is required"),
		email: z.email("Enter a valid email address"),
		initialEventId: z.string().min(1, "Pick an initial event."),
	});

const AddToEvent = z.object({
	emails: z
		.array(z.string().min(1))
		.min(1, "Select at least one person.")
		.max(BULK_MAX, "Add people in batches of up to 50 — narrow the selection."),
	targetEventId: z.string().min(1, "Pick an event."),
});

const Enroll = z.object({
	emails: z
		.array(z.string().min(1))
		.min(1, "Select at least one person.")
		.max(BULK_MAX, "Enroll in batches of up to 50 — narrow the selection."),
	stage: z.enum(PIPELINE_STAGE),
});

const SaveSegment = z.object({
	name: z
		.string()
		.trim()
		.min(1, "Name the segment before saving.")
		.max(120, "Segment names cap at 120 characters."),
});

type AddPersonValues = {
	firstName: string;
	lastName: string;
	email: string;
	jobTitle: string;
	companyName: string;
	initialEventId: string;
};

type ActionData = {
	addPerson?: boolean;
	fieldErrors?: Record<string, string[] | undefined>;
	formError?: string;
	notice?: string;
	duplicate?: { name: string; email: string };
	existing?: { name: string; email: string };
	values?: AddPersonValues;
};

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
	if (intent === "add-person") {
		return addPersonAction(db, org.id, form);
	}
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

async function addPersonAction(
	db: ReturnType<typeof getDb>,
	orgId: string,
	form: FormData,
): Promise<ReturnType<typeof data<ActionData>> | Response> {
	const values: AddPersonValues = {
		firstName: String(form.get("firstName") ?? ""),
		lastName: String(form.get("lastName") ?? ""),
		email: String(form.get("email") ?? ""),
		jobTitle: String(form.get("jobTitle") ?? ""),
		companyName: String(form.get("companyName") ?? ""),
		initialEventId: String(form.get("initialEventId") ?? ""),
	};
	const parsed = NewPerson.safeParse({
		firstName: values.firstName,
		lastName: values.lastName,
		email: normalizeEmail(values.email),
		jobTitle: values.jobTitle || null,
		companyName: values.companyName || null,
		initialEventId: values.initialEventId,
	});
	const timings = createTimings();
	if (!parsed.success) {
		return data<ActionData>(
			{
				addPerson: true,
				fieldErrors: z.flattenError(parsed.error).fieldErrors,
				values,
			},
			{ headers: { "Server-Timing": timings.header() } },
		);
	}
	const { initialEventId, ...person } = parsed.data;
	const [initialEvent] = await timings.time("event", () =>
		db
			.select({ id: events.id })
			.from(events)
			.where(
				and(eq(events.id, initialEventId), eq(events.organizationId, orgId)),
			)
			.limit(1),
	);
	if (!initialEvent) {
		return data<ActionData>(
			{
				addPerson: true,
				fieldErrors: {
					initialEventId: ["Pick an initial event from your organization."],
				},
				values,
			},
			{ headers: { "Server-Timing": timings.header() } },
		);
	}

	const findExactEmail = () =>
		db
			.select({
				email: contacts.email,
				firstName: contacts.firstName,
				lastName: contacts.lastName,
			})
			.from(contacts)
			.innerJoin(events, eq(events.id, contacts.eventId))
			.where(
				and(
					eq(events.organizationId, orgId),
					sql`lower(${contacts.email}) = ${person.email}`,
				),
			)
			.orderBy(desc(contacts.createdAt), desc(contacts.id))
			.limit(1);
	const [existing] = await timings.time("emailCheck", findExactEmail);
	if (existing) {
		return data<ActionData>(
			{
				addPerson: true,
				existing: {
					name: `${existing.firstName} ${existing.lastName}`.trim(),
					email: normalizeEmail(existing.email),
				},
				values,
			},
			{ headers: { "Server-Timing": timings.header() } },
		);
	}

	if (form.get("confirmDuplicate") !== "1") {
		const [duplicate] = await timings.time("nameCheck", () =>
			db
				.select({ email: contacts.email })
				.from(contacts)
				.innerJoin(events, eq(events.id, contacts.eventId))
				.where(
					and(
						eq(events.organizationId, orgId),
						sql`lower(trim(${contacts.firstName})) = lower(${person.firstName})`,
						sql`lower(trim(${contacts.lastName})) = lower(${person.lastName})`,
						sql`lower(${contacts.email}) <> ${person.email}`,
					),
				)
				.orderBy(asc(contacts.createdAt), asc(contacts.id))
				.limit(1),
		);
		if (duplicate) {
			return data<ActionData>(
				{
					addPerson: true,
					duplicate: {
						name: `${person.firstName} ${person.lastName}`.trim(),
						email: normalizeEmail(duplicate.email),
					},
					values,
				},
				{ headers: { "Server-Timing": timings.header() } },
			);
		}
	}

	try {
		const [created] = await timings.time("db", () =>
			db
				.insert(contacts)
				.values({ ...person, eventId: initialEvent.id })
				.returning({ id: contacts.id }),
		);
		track("crm.person_created", {
			orgId,
			eventId: initialEvent.id,
			contactId: created?.id,
		});
		return redirect(`/admin/crm/person/${encodeURIComponent(person.email)}`, {
			headers: { "Server-Timing": timings.header() },
		});
	} catch (error) {
		if (isUniqueViolation(error)) {
			const [raceWinner] = await findExactEmail();
			if (raceWinner) {
				return data<ActionData>(
					{
						addPerson: true,
						existing: {
							name: `${raceWinner.firstName} ${raceWinner.lastName}`.trim(),
							email: normalizeEmail(raceWinner.email),
						},
					},
					{ headers: { "Server-Timing": timings.header() } },
				);
			}
		}
		track("crm.person_create_failed", {
			orgId,
			error: errorMessage(error),
		});
		return data<ActionData>(
			{
				addPerson: true,
				formError: "Could not add the person — please try again.",
				values,
			},
			{ headers: { "Server-Timing": timings.header() } },
		);
	}
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
	const { outcome, ...result } = await timings.time("db", () =>
		addToEventNotice(
			db,
			orgId,
			[...new Set(parsed.data.emails.map(normalizeEmail))],
			parsed.data.targetEventId,
		),
	);
	track("crm.added_to_event", {
		orgId,
		eventId: parsed.data.targetEventId,
		outcome,
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
	const busy = useBusy();
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const toggleSelected = (email: string, checked: boolean) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (checked) next.add(email);
			else next.delete(email);
			return next;
		});
	};
	const composeUrl = `/admin/contacts/compose?${new URLSearchParams({
		directoryEmails: [...selected].join(","),
	}).toString()}`;
	const filtered = hasDirectoryFilters(filters);
	const from = total === 0 ? 0 : (page - 1) * perPage + 1;
	const to = Math.min(page * perPage, total);
	const notice =
		actionData && "notice" in actionData ? actionData.notice : undefined;
	const formError =
		actionData && "formError" in actionData ? actionData.formError : undefined;
	const fieldErrors =
		actionData && "fieldErrors" in actionData
			? actionData.fieldErrors
			: undefined;
	const duplicate =
		actionData && "duplicate" in actionData ? actionData.duplicate : undefined;
	const existing =
		actionData && "existing" in actionData ? actionData.existing : undefined;
	const values =
		actionData && "values" in actionData ? actionData.values : undefined;
	const addPersonResponse =
		actionData && "addPerson" in actionData && actionData.addPerson === true;

	return (
		<div className="min-w-0 flex flex-col gap-5">
			<Panel>
				<Form method="post" className="flex flex-col gap-3">
					<Input type="hidden" name="intent" value="add-person" readOnly />
					<p>
						Add a person directly to the organization directory. Their initial
						event stores the first appearance in their cross-event profile.
					</p>
					<div className="grid grid-cols-1 gap-3 md:grid-cols-3">
						<Field label="First name" error={fieldErrors?.firstName?.[0]}>
							<Input
								name="firstName"
								autoComplete="given-name"
								defaultValue={values?.firstName}
								invalid={Boolean(fieldErrors?.firstName?.[0])}
							/>
						</Field>
						<Field label="Last name" error={fieldErrors?.lastName?.[0]}>
							<Input
								name="lastName"
								autoComplete="family-name"
								defaultValue={values?.lastName}
								invalid={Boolean(fieldErrors?.lastName?.[0])}
							/>
						</Field>
						<Field label="Email" error={fieldErrors?.email?.[0]}>
							<Input
								name="email"
								type="email"
								autoComplete="email"
								defaultValue={values?.email}
								invalid={Boolean(fieldErrors?.email?.[0])}
							/>
						</Field>
						<Field label="Job title">
							<Input
								name="jobTitle"
								autoComplete="organization-title"
								defaultValue={values?.jobTitle}
							/>
						</Field>
						<Field label="Company">
							<Input
								name="companyName"
								autoComplete="organization"
								defaultValue={values?.companyName}
							/>
						</Field>
						<Field
							label="Initial event"
							error={fieldErrors?.initialEventId?.[0]}
						>
							<Select
								name="initialEventId"
								defaultValue={values?.initialEventId ?? ""}
								aria-invalid={
									Boolean(fieldErrors?.initialEventId?.[0]) || undefined
								}
							>
								<option value="" disabled>
									Pick an event…
								</option>
								{events.map((event) => (
									<option key={event.id} value={event.id}>
										{event.name}
									</option>
								))}
							</Select>
						</Field>
					</div>
					{duplicate && (
						<div role="alert">
							<ErrorText>
								A person named {duplicate.name} already exists in this
								organization ({duplicate.email}). Create this one anyway?
							</ErrorText>
						</div>
					)}
					{existing && (
						<div role="alert" className="flex flex-wrap items-center gap-3">
							<ErrorText>
								{existing.name} already uses this email in the organization.
							</ErrorText>
							<ButtonLink
								to={`/admin/crm/person/${encodeURIComponent(existing.email)}`}
								variant="ghost"
							>
								Open existing person
							</ButtonLink>
						</div>
					)}
					<div className="flex flex-wrap items-center gap-3">
						<Button type="submit" icon="plus" disabled={busy}>
							Add person
						</Button>
						<ButtonLink
							to="/admin/crm/directory/import"
							variant="ghost"
							icon="export"
						>
							Import from CSV
						</ButtonLink>
						{duplicate && (
							<Button
								type="submit"
								name="confirmDuplicate"
								value="1"
								variant="ghost"
								disabled={busy}
							>
								Create anyway
							</Button>
						)}
						{addPersonResponse && formError && (
							<div role="alert">
								<ErrorText>{formError}</ErrorText>
							</div>
						)}
					</div>
				</Form>
			</Panel>

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
							disabled={busy}
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
					{selected.size > 0 ? (
						<ButtonLink to={composeUrl} variant="ghost" icon="mail">
							Email selected
						</ButtonLink>
					) : (
						<Button type="button" variant="ghost" icon="mail" disabled>
							Email selected
						</Button>
					)}
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
				{!addPersonResponse && formError && <ErrorText>{formError}</ErrorText>}
			</Panel>

			<div className="min-w-0 flex flex-col gap-2">
				<p className="flex justify-end">
					Scroll horizontally to see all columns →
				</p>
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
								No people match these filters — clear them to see everyone in
								your organization.
							</EmptyRow>
						)}
					</TBody>
				</Table>
			</div>
			{people.length === 0 && !filtered && (
				<Panel>
					<EmptyState
						icon="users"
						title="No people in your organization yet"
						body="Add a person above to start your organization directory, or import a list. Each person has one cross-event profile with their event appearances and workflow history."
						action={
							<div className="flex flex-wrap items-center gap-2">
								<ButtonLink to="/admin/crm/directory/import" icon="export">
									Import from CSV
								</ButtonLink>
								<ButtonLink to="/admin/contacts" variant="ghost" icon="plus">
									Go to the event roster
								</ButtonLink>
							</div>
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
