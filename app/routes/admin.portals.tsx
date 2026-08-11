import { and, asc, count, eq } from "drizzle-orm";
import { useRef, useState } from "react";
import { data, Form, redirect, useSubmit } from "react-router";
import { getDb } from "~/db";
import { contactFilter } from "~/domain/contacts";
import { contacts, portals } from "~/db/schema";
import { getActiveEvent, isSecureRequest, requireAdmin } from "~/lib/auth";
import { formatDateUTC } from "~/lib/format";
import {
	clearPreviewCookie,
	contactDisplayName,
	previewContactForAdmin,
	startPreviewCookie,
} from "~/lib/portal-preview";
import { portalUrl } from "~/lib/portal-url";
import { createTimings, track } from "~/lib/track";
import {
	Button,
	EmptyRow,
	EmptyState,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	SearchInput,
	Select,
	StatusBadge,
	Tab,
	Table,
	Tabs,
	TBody,
	Td,
	TextLink,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.portals";

const CONTACT_PAGE = 20;

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader.
	const user = await requireAdmin(env, request);
	const event = await getActiveEvent(env, user);
	const url = new URL(request.url);
	const q = (url.searchParams.get("q") ?? "").trim();

	const empty = {
		eventName: null as string | null,
		q,
		portals: [] as Array<{
			publicId: string;
			name: string;
			url: string;
			createdAt: Date;
		}>,
		contacts: [] as Array<{
			id: string;
			name: string;
			email: string;
			hasAccount: boolean;
		}>,
		contactsTotal: 0,
		previewing: null as { contactName: string } | null,
	};
	if (!event) return empty;

	const db = getDb(env);
	const timings = createTimings();
	// THE roster predicate — the preview picker must match the same people the
	// Contacts roster search does, or "who matches" diverges between surfaces.
	const contactScope = contactFilter(event.id, { q });

	const result = await timings.time("db", async () => {
		const portalRows = await db
			.select({
				publicId: portals.publicId,
				name: portals.name,
				createdAt: portals.createdAt,
			})
			.from(portals)
			.where(eq(portals.eventId, event.id))
			.orderBy(asc(portals.createdAt));
		const contactRows = await db
			.select({
				id: contacts.id,
				firstName: contacts.firstName,
				lastName: contacts.lastName,
				email: contacts.email,
				userId: contacts.userId,
			})
			.from(contacts)
			.where(contactScope)
			.orderBy(asc(contacts.lastName), asc(contacts.firstName))
			.limit(CONTACT_PAGE);
		const [total] = await db
			.select({ n: count() })
			.from(contacts)
			.where(contactScope);
		const previewContact = await previewContactForAdmin(
			env,
			db,
			request,
			user.id,
		);
		const previewing = previewContact
			? { contactName: contactDisplayName(previewContact) }
			: null;
		const origin = url.origin;
		return {
			...empty,
			portals: portalRows.map((p) => ({
				publicId: p.publicId,
				name: p.name,
				url: portalUrl(origin, event.slug, p.publicId),
				createdAt: p.createdAt,
			})),
			contacts: contactRows.map((c) => ({
				id: c.id,
				name: contactDisplayName(c),
				email: c.email,
				hasAccount: c.userId !== null,
			})),
			contactsTotal: total?.n ?? 0,
			previewing,
		};
	});

	return data(
		{ ...result, eventName: event.name },
		{ headers: { "Server-Timing": timings.header() } },
	);
}

type ActionResult = { formError?: string };

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions MUST self-authenticate — a POST does not re-run the layout loader.
	const user = await requireAdmin(env, request);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");
	const secure = isSecureRequest(request);

	if (intent === "exit-preview") {
		track("portal.preview_exited", { userId: user.id });
		return redirect("/admin/portals", {
			headers: { "Set-Cookie": clearPreviewCookie(secure) },
		});
	}

	if (intent === "start-preview") {
		const event = await getActiveEvent(env, user);
		if (!event) {
			return {
				formError: "No event is configured yet.",
			} satisfies ActionResult;
		}
		const db = getDb(env);
		const contactId = String(form.get("contactId") ?? "");
		const portalPublicId = String(form.get("portalPublicId") ?? "");
		// Both ids are re-verified against the ACTIVE event — a forged POST can
		// never start a preview into another tenant's portal or contact.
		const [contact] = await db
			.select({ id: contacts.id })
			.from(contacts)
			.where(and(eq(contacts.id, contactId), eq(contacts.eventId, event.id)))
			.limit(1);
		const [portal] = await db
			.select({ publicId: portals.publicId })
			.from(portals)
			.where(
				and(
					eq(portals.publicId, portalPublicId),
					eq(portals.eventId, event.id),
				),
			)
			.limit(1);
		if (!contact || !portal) {
			track("portal.preview_refused", {
				userId: user.id,
				eventId: event.id,
				reason: "contact or portal outside the active event",
			});
			return {
				formError:
					"That speaker or portal no longer exists in this event — refresh and try again.",
			} satisfies ActionResult;
		}
		track("portal.preview_started", {
			userId: user.id,
			eventId: event.id,
			contactId: contact.id,
		});
		return redirect(`/portals/${event.slug}/${portal.publicId}/home`, {
			headers: { "Set-Cookie": startPreviewCookie(contact.id, secure) },
		});
	}

	return { formError: "Unknown action." } satisfies ActionResult;
}

function CopyLink({ url }: { url: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="flex items-center gap-2">
			<div className="w-full max-w-xs">
				<Input
					value={url}
					readOnly
					aria-label="Portal link"
					onFocus={(e) => e.currentTarget.select()}
				/>
			</div>
			<Button
				type="button"
				variant="ghost"
				onClick={() => {
					void navigator.clipboard.writeText(url);
					setCopied(true);
				}}
			>
				{copied ? "Copied" : "Copy"}
			</Button>
		</div>
	);
}

export default function PortalsAdmin({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { eventName, q, portals, contacts, contactsTotal, previewing } =
		loaderData;
	const [portalPublicId, setPortalPublicId] = useState(
		portals[0]?.publicId ?? "",
	);
	const submit = useSubmit();
	const searchDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);

	if (!eventName) {
		return (
			<div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-6">
				<PageHeader
					title="Portals"
					subtitle="Create an event first — its speaker portal is provisioned with it."
				/>
			</div>
		);
	}

	return (
		<div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-6">
			<PageHeader
				title="Portals"
				count={String(portals.length)}
				subtitle="Where speakers complete tasks, submit forms, and manage their profile."
			/>

			<Tabs>
				<Tab to="/admin/portals">Portals</Tab>
				<Tab to="/admin/portal-forms">Portal forms</Tab>
			</Tabs>

			{actionData?.formError && <ErrorText>{actionData.formError}</ErrorText>}

			{previewing && (
				<Panel>
					<div className="flex flex-wrap items-center gap-4">
						<StatusBadge tone="warning">Preview active</StatusBadge>
						<span className="flex-1">
							You are currently previewing the portal as{" "}
							<strong>{previewing.contactName}</strong>.
						</span>
						<Form method="post">
							<Input type="hidden" name="intent" value="exit-preview" />
							<Button type="submit" variant="ghost">
								Exit preview
							</Button>
						</Form>
					</div>
				</Panel>
			)}

			<Table>
				<THead>
					<Th>Portal</Th>
					<Th>Login link</Th>
					<Th>Created</Th>
				</THead>
				<TBody>
					{portals.map((p) => (
						<Tr key={p.publicId}>
							<Td kind="strong">{p.name}</Td>
							<Td>
								<CopyLink url={p.url} />
							</Td>
							<Td kind="mono">{formatDateUTC(p.createdAt)}</Td>
						</Tr>
					))}
					{portals.length === 0 && (
						<EmptyRow colSpan={3}>
							<EmptyState
								icon="users"
								title="No portal yet"
								body="Every event gets a speaker portal when it is created. If this event has none, recreate it or contact support."
							/>
						</EmptyRow>
					)}
				</TBody>
			</Table>

			<Panel>
				<div className="flex flex-col gap-4">
					<PageHeader
						title="View portal as"
						subtitle="Open the portal exactly as a speaker sees it — read-only, with all actions disabled."
					/>
					<div className="flex flex-wrap items-end gap-4">
						<Form method="get" className="flex flex-wrap items-end gap-4">
							<SearchInput
								name="q"
								placeholder="Search speakers by name, email, or company…"
								defaultValue={q}
								onChange={(e) => {
									// Search-as-you-type: debounced GET resubmit; replace so
									// every keystroke doesn't mint a history entry.
									const form = e.currentTarget.form;
									clearTimeout(searchDebounce.current);
									searchDebounce.current = setTimeout(() => {
										if (form) submit(form, { replace: true });
									}, 200);
								}}
							/>
							<Button type="submit" variant="ghost" icon="search">
								Search
							</Button>
						</Form>
						{portals.length > 1 && (
							<Field label="Portal to preview">
								<Select
									value={portalPublicId}
									onChange={(e) => setPortalPublicId(e.currentTarget.value)}
								>
									{portals.map((p) => (
										<option key={p.publicId} value={p.publicId}>
											{p.name}
										</option>
									))}
								</Select>
							</Field>
						)}
					</div>
					<Table>
						<THead>
							<Th>Speaker</Th>
							<Th>Email</Th>
							<Th>Portal account</Th>
							<Th />
						</THead>
						<TBody>
							{contacts.map((c) => (
								<Tr key={c.id}>
									<Td kind="strong">{c.name}</Td>
									<Td kind="mono">{c.email}</Td>
									<Td>
										{c.hasAccount ? (
											<StatusBadge tone="success">Has access</StatusBadge>
										) : (
											<StatusBadge tone="neutral">
												Not logged in yet
											</StatusBadge>
										)}
									</Td>
									<Td>
										<Form method="post">
											<Input
												type="hidden"
												name="intent"
												value="start-preview"
											/>
											<Input type="hidden" name="contactId" value={c.id} />
											<Input
												type="hidden"
												name="portalPublicId"
												value={portalPublicId}
											/>
											<Button
												type="submit"
												variant="ghost"
												icon="eye"
												disabled={portals.length === 0}
											>
												Preview
											</Button>
										</Form>
									</Td>
								</Tr>
							))}
							{contacts.length === 0 && (
								<EmptyRow colSpan={4}>
									{contactsTotal === 0 && q === "" ? (
										<EmptyState
											icon="mic"
											title="No contacts yet"
											body="Add speakers in Contacts (or accept a submission) and preview their portal from here."
											action={
												<TextLink to="/admin/contacts">Go to Contacts</TextLink>
											}
										/>
									) : (
										<EmptyState
											icon="search"
											title="No contacts match"
											body="Try another name, email, company, or title, or clear the search to see every contact."
											action={
												<TextLink to="/admin/portals">Clear search</TextLink>
											}
										/>
									)}
								</EmptyRow>
							)}
						</TBody>
					</Table>
					{contactsTotal > contacts.length && (
						<span>
							Showing first {contacts.length} of {contactsTotal} — refine your
							search to find a specific speaker.
						</span>
					)}
				</div>
			</Panel>
		</div>
	);
}

export function ErrorBoundary() {
	// Generic message only — the raw error can carry SQL/row values.
	return (
		<div className="mx-auto max-w-6xl px-8 py-6">
			<PageHeader
				title="Failed to load portals"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
