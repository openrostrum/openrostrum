import { and, count, eq, ne, sql } from "drizzle-orm";
import { useState } from "react";
import { data, Form, Link, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { CONTACT_STATUS } from "~/db/constants";
import { contacts, insertContactSchema } from "~/db/schema";
import { CONTACT_STATUS_TONE } from "~/components/contact-status";
import { HeadshotAvatar } from "~/components/headshot-avatar";
import { contactFilter, isContactStatus } from "~/domain/contacts";
import { getActiveEvent, normalizeEmail, requireAdmin } from "~/lib/auth";
import { errorMessage, isUniqueViolation } from "~/lib/errors";
import { headshotUrl } from "~/lib/headshot";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import {
	Button,
	ButtonLink,
	EmptyRow,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	SearchInput,
	StatusBadge,
	Tab,
	Table,
	TableFooter,
	Tabs,
	TBody,
	Td,
	Textarea,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.contacts";

const PER_PAGE = 50;

const NewContact = insertContactSchema
	.pick({
		firstName: true,
		lastName: true,
		email: true,
		jobTitle: true,
		companyName: true,
		bio: true,
	})
	.extend({
		firstName: z.string().min(1, "First name is required"),
		lastName: z.string().min(1, "Last name is required"),
		email: z.email("Enter a valid email address"),
	});

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return {
			rows: [],
			counts: { all: 0, pending: 0, invited: 0, confirmed: 0, declined: 0 },
			total: 0,
			page: 1,
			perPage: PER_PAGE,
			q: "",
			status: null,
			eventName: null as string | null,
		};
	}
	const url = new URL(request.url);
	const q = url.searchParams.get("q") ?? "";
	const statusParam = url.searchParams.get("status");
	const status = isContactStatus(statusParam) ? statusParam : null;
	const db = getDb(env);
	const timings = createTimings();

	const byStatus = await timings.time("counts", () =>
		db
			.select({ status: contacts.status, n: count() })
			.from(contacts)
			.where(contactFilter(event.id, { q }))
			.groupBy(contacts.status),
	);
	const counts = { all: 0, pending: 0, invited: 0, confirmed: 0, declined: 0 };
	for (const row of byStatus) {
		counts[row.status] = row.n;
		counts.all += row.n;
	}
	const total = status ? counts[status] : counts.all;
	const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));
	const page = Math.min(
		Math.max(1, Number(url.searchParams.get("page")) || 1),
		lastPage,
	);

	const rows = await timings.time("db", () =>
		db
			.select({
				id: contacts.id,
				firstName: contacts.firstName,
				lastName: contacts.lastName,
				email: contacts.email,
				jobTitle: contacts.jobTitle,
				companyName: contacts.companyName,
				status: contacts.status,
				headshotKey: contacts.headshotKey,
				sessionCount: sql<number>`(
					SELECT COUNT(*) FROM participants
					WHERE participants.contact_id = ${contacts.id}
				)`,
			})
			.from(contacts)
			.where(contactFilter(event.id, { q, status }))
			.orderBy(contacts.lastName, contacts.firstName)
			.limit(PER_PAGE)
			.offset((page - 1) * PER_PAGE),
	);

	return data(
		{
			// The r2 key stays server-side; rows carry only the authz'd image URL.
			rows: rows.map(({ headshotKey, ...row }) => ({
				...row,
				headshotUrl: headshotUrl(
					`/admin/contacts/${row.id}/headshot`,
					headshotKey,
				),
			})),
			counts,
			total,
			page,
			perPage: PER_PAGE,
			q,
			status: status as string | null,
			eventName: event.name,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

type ActionResult = {
	fieldErrors?: Record<string, string[] | undefined>;
	formError?: string;
	/** Same name already on the roster under another email — a non-blocking
	 * warning: resubmitting with confirmDuplicate creates the contact anyway. */
	duplicate?: { name: string; email: string };
};

export async function action({
	context,
	request,
}: Route.ActionArgs): Promise<
	ActionResult | ReturnType<typeof data<ActionResult>> | Response
> {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	if (!event) {
		return { formError: "No event is configured yet." };
	}
	const db = getDb(env);
	const form = await request.formData();
	const parsed = NewContact.safeParse({
		firstName: form.get("firstName"),
		lastName: form.get("lastName"),
		email: normalizeEmail(String(form.get("email") ?? "")),
		jobTitle: form.get("jobTitle") || null,
		companyName: form.get("companyName") || null,
		bio: form.get("bio") || null,
	});
	if (!parsed.success) {
		return {
			fieldErrors: z.flattenError(parsed.error).fieldErrors,
		};
	}
	const timings = createTimings();
	if (form.get("confirmDuplicate") !== "1") {
		const [dup] = await timings.time("dupCheck", () =>
			db
				.select({ email: contacts.email })
				.from(contacts)
				.where(
					and(
						eq(contacts.eventId, event.id),
						// Same-email rows fall through to the unique-violation field
						// error below — that message names the real conflict.
						ne(contacts.email, parsed.data.email),
						sql`lower(${contacts.firstName}) = lower(${parsed.data.firstName})`,
						sql`lower(${contacts.lastName}) = lower(${parsed.data.lastName})`,
					),
				)
				.limit(1),
		);
		if (dup) {
			return data<ActionResult>(
				{
					duplicate: {
						name: `${parsed.data.firstName} ${parsed.data.lastName}`.trim(),
						email: dup.email,
					},
				},
				{ headers: { "Server-Timing": timings.header() } },
			);
		}
	}
	try {
		const [created] = await timings.time("db", () =>
			db
				.insert(contacts)
				.values({ ...parsed.data, eventId: event.id })
				.returning({ id: contacts.id }),
		);
		track("contact.created", { eventId: event.id, contactId: created?.id });
		return redirect(`/admin/contacts/${created?.id}`, {
			headers: { "Server-Timing": timings.header() },
		});
	} catch (error) {
		if (isUniqueViolation(error)) {
			return {
				fieldErrors: {
					email: ["A contact with this email already exists for this event."],
				},
			};
		}
		track("contact.create_failed", {
			eventId: event.id,
			error: errorMessage(error),
		});
		return {
			formError: "Could not save the contact — please try again.",
		};
	}
}

function pageUrl(q: string, status: string | null, page?: number): string {
	const params = new URLSearchParams();
	if (q) params.set("q", q);
	if (status) params.set("status", status);
	if (page && page > 1) params.set("page", String(page));
	const query = params.toString();
	return `/admin/contacts${query ? `?${query}` : ""}`;
}

export default function ContactsRoster({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { rows, counts, total, page, perPage, q, status } = loaderData;
	const composeParams = new URLSearchParams();
	if (q) composeParams.set("q", q);
	if (status) composeParams.set("status", status);
	const from = total === 0 ? 0 : (page - 1) * perPage + 1;
	const to = Math.min(page * perPage, total);
	const busy = useBusy();
	// The search box is controlled and re-synced from the URL (render-time
	// adjustment, not an effect): what the box shows is exactly what a Search
	// click serializes, and a Clear/tab navigation can never leave stale text —
	// an uncontrolled box and the URL drift apart (judged: empty-q submits).
	const [query, setQuery] = useState(q);
	const [syncedQ, setSyncedQ] = useState(q);
	if (q !== syncedQ) {
		setSyncedQ(q);
		setQuery(q);
	}

	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Speakers"
				count={`${total} contacts`}
				subtitle="The event roster — every person on a submission, imported, or added by hand."
				actions={
					<>
						<ButtonLink
							to={`/admin/contacts/compose?${composeParams.toString()}`}
							variant="ghost"
							icon="mail"
						>
							Email speakers
						</ButtonLink>
						<ButtonLink
							to="/admin/contacts/import"
							variant="ghost"
							icon="export"
						>
							Import CSV
						</ButtonLink>
					</>
				}
			/>

			<Panel>
				<Form method="post" className="flex flex-col gap-3">
					<div className="grid grid-cols-2 gap-3 md:grid-cols-3">
						<Field
							label="First name"
							error={actionData?.fieldErrors?.firstName?.[0]}
						>
							<Input
								name="firstName"
								autoComplete="off"
								invalid={Boolean(actionData?.fieldErrors?.firstName?.[0])}
							/>
						</Field>
						<Field
							label="Last name"
							error={actionData?.fieldErrors?.lastName?.[0]}
						>
							<Input
								name="lastName"
								autoComplete="off"
								invalid={Boolean(actionData?.fieldErrors?.lastName?.[0])}
							/>
						</Field>
						<Field label="Email" error={actionData?.fieldErrors?.email?.[0]}>
							<Input
								name="email"
								type="email"
								autoComplete="off"
								invalid={Boolean(actionData?.fieldErrors?.email?.[0])}
							/>
						</Field>
						<Field label="Job title">
							<Input name="jobTitle" autoComplete="off" />
						</Field>
						<Field label="Company">
							<Input name="companyName" autoComplete="off" />
						</Field>
					</div>
					<Field label="Bio">
						<Textarea name="bio" rows={3} />
					</Field>
					<div className="flex flex-col gap-2">
						{actionData?.duplicate && (
							<div role="alert">
								<ErrorText>
									A contact named {actionData.duplicate.name} already exists for
									this event ({actionData.duplicate.email}). Create this one
									anyway?
								</ErrorText>
							</div>
						)}
						<div className="flex items-center gap-3">
							<Button type="submit" icon="plus" disabled={busy}>
								Add speaker
							</Button>
							{actionData?.duplicate && (
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
							{actionData?.formError && (
								<div role="alert">
									<ErrorText>{actionData.formError}</ErrorText>
								</div>
							)}
						</div>
					</div>
				</Form>
			</Panel>

			<Tabs>
				<Tab to={pageUrl(q, null)} active={status === null} count={counts.all}>
					All
				</Tab>
				{CONTACT_STATUS.map((s) => (
					<Tab
						key={s}
						to={pageUrl(q, s)}
						active={status === s}
						count={counts[s] ?? 0}
					>
						{s.charAt(0).toUpperCase() + s.slice(1)}
					</Tab>
				))}
			</Tabs>

			<Form method="get" className="flex items-center gap-2">
				<SearchInput
					name="q"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search name, email, company…"
					aria-label="Search contacts"
				/>
				{status && (
					<Input type="hidden" name="status" value={status} readOnly />
				)}
				<Button type="submit" variant="ghost" icon="search">
					Search
				</Button>
				{q && (
					<ButtonLink to={pageUrl("", status)} variant="ghost">
						Clear
					</ButtonLink>
				)}
			</Form>

			<Table>
				<THead>
					<Th>Name</Th>
					<Th>Email</Th>
					<Th>Title · Company</Th>
					<Th>Status</Th>
					<Th>Sessions</Th>
					<Th />
				</THead>
				<TBody>
					{rows.map((c) => {
						const name = `${c.firstName} ${c.lastName}`.trim();
						return (
							<Tr key={c.id}>
								<Td kind="strong">
									<Link
										to={`/admin/contacts/${c.id}`}
										className="flex items-center gap-2"
									>
										<HeadshotAvatar name={name} src={c.headshotUrl} />
										{name}
									</Link>
								</Td>
								<Td kind="mono">{c.email}</Td>
								<Td>
									{[c.jobTitle, c.companyName].filter(Boolean).join(" · ") ||
										"—"}
								</Td>
								<Td>
									<StatusBadge tone={CONTACT_STATUS_TONE[c.status]}>
										{c.status}
									</StatusBadge>
								</Td>
								<Td kind="mono">{c.sessionCount}</Td>
								<Td>
									<ButtonLink to={`/admin/contacts/${c.id}`} variant="ghost">
										Open
									</ButtonLink>
								</Td>
							</Tr>
						);
					})}
					{rows.length === 0 && (
						<EmptyRow colSpan={6}>
							{q || status
								? "No contacts match this search or filter — clear it to see the full roster."
								: "No speakers yet — add one above, or import your roster from a CSV file."}
						</EmptyRow>
					)}
				</TBody>
			</Table>

			{total > 0 && (
				<TableFooter>
					<span>
						{from}–{to} of {total}
					</span>
					<span className="ml-auto flex items-center gap-2">
						{page > 1 && (
							<ButtonLink to={pageUrl(q, status, page - 1)} variant="ghost">
								Previous
							</ButtonLink>
						)}
						{to < total && (
							<ButtonLink to={pageUrl(q, status, page + 1)} variant="ghost">
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
		<div className="mx-auto max-w-5xl px-7 py-6">
			<PageHeader
				title="Failed to load the speaker roster"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
