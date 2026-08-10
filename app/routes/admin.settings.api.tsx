import { and, asc, desc, eq } from "drizzle-orm";
import { data, Form, redirect, useNavigation } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { apiTokens, events } from "~/db/schema";
import { sha256Hex } from "~/lib/api-token";
import { requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { resolveOrg } from "~/lib/org.server";
import { createTimings, track } from "~/lib/track";
import {
	Button,
	ConfirmButton,
	EmptyState,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	Select,
	Table,
	TBody,
	Td,
	Th,
	THead,
	Tr,
} from "~/ui";
import { CopyFieldButton } from "~/widgets";
import type { Route } from "./+types/admin.settings.api";

const CreateToken = z.object({
	name: z
		.string()
		.trim()
		.min(1, "Name the token so you can recognize it later.")
		.max(200, "Keep the name under 200 characters."),
	eventId: z.string(),
});

/** `or_` + 128 random bits, hex — recognizable in configs and greppable in
 * leaks. Only its SHA-256 is stored; the raw value renders exactly once. */
function mintRawToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	let hex = "";
	for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
	return `or_${hex}`;
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
});

export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
	return actionHeaders.has("Server-Timing") ? actionHeaders : loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Self-authenticate — never rely on the admin.tsx layout loader.
	const user = await requireAdmin(env, request);
	const org = await resolveOrg(env, user);
	const revoked = new URL(request.url).searchParams.get("revoked") === "1";
	if (!org) return data({ org: null, revoked } as const);

	const db = getDb(env);
	const timings = createTimings();
	const { tokens, orgEvents } = await timings.time("db", async () => ({
		tokens: await db
			.select({
				id: apiTokens.id,
				name: apiTokens.name,
				eventName: events.name,
				createdAt: apiTokens.createdAt,
				lastUsedAt: apiTokens.lastUsedAt,
			})
			.from(apiTokens)
			.leftJoin(events, eq(events.id, apiTokens.eventId))
			.where(eq(apiTokens.organizationId, org.id))
			.orderBy(desc(apiTokens.createdAt), desc(apiTokens.id)),
		orgEvents: await db
			.select({ id: events.id, name: events.name })
			.from(events)
			.where(eq(events.organizationId, org.id))
			.orderBy(asc(events.createdAt)),
	}));
	return data(
		{
			org: { id: org.id, name: org.name },
			tokens: tokens.map((t) => ({
				id: t.id,
				name: t.name,
				scope: t.eventName ?? "All events",
				createdAt: dateFormat.format(t.createdAt),
				lastUsedAt: t.lastUsedAt ? dateFormat.format(t.lastUsedAt) : null,
			})),
			events: orgEvents,
			revoked,
		} as const,
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions self-authenticate — a POST never runs the layout loader.
	const user = await requireAdmin(env, request);
	const org = await resolveOrg(env, user);
	if (!org) {
		return {
			formError:
				"You aren't a member of an organization yet, so there are no API tokens to manage.",
		};
	}
	const db = getDb(env);
	const form = await request.formData();
	const timings = createTimings();
	try {
		// The revoke button carries the row id as its value; the plain create
		// form is the default. Dispatch is key-presence (team-page pattern).
		const result = await timings.time("db", async () => {
			if (form.has("revoke")) {
				return revokeToken(db, org.id, String(form.get("revoke")));
			}
			return createToken(db, org.id, form);
		});
		if (result instanceof Response) {
			result.headers.append("Server-Timing", timings.header());
			return result;
		}
		return data(result, { headers: { "Server-Timing": timings.header() } });
	} catch (error) {
		// Log the detail server-side; never leak SQL / row values into the UI.
		track("api.token_action_failed", {
			orgId: org.id,
			error: errorMessage(error),
		});
		return { formError: "Something went wrong — please try again." };
	}
}

type Db = ReturnType<typeof getDb>;

async function createToken(db: Db, orgId: string, form: FormData) {
	const parsed = CreateToken.safeParse({
		name: form.get("name"),
		eventId: form.get("eventId") ?? "",
	});
	if (!parsed.success) {
		return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
	}
	// The restriction must name one of THIS org's events — a forged id from
	// another org is refused before anything is written.
	let eventId: string | null = null;
	if (parsed.data.eventId !== "") {
		const [owned] = await db
			.select({ id: events.id })
			.from(events)
			.where(
				and(
					eq(events.id, parsed.data.eventId),
					eq(events.organizationId, orgId),
				),
			)
			.limit(1);
		if (!owned) {
			return {
				fieldErrors: {
					eventId: ["That event doesn't exist in this organization."],
				},
			};
		}
		eventId = parsed.data.eventId;
	}
	const raw = mintRawToken();
	const [row] = await db
		.insert(apiTokens)
		.values({
			organizationId: orgId,
			eventId,
			name: parsed.data.name,
			tokenHash: await sha256Hex(raw),
		})
		.returning({ id: apiTokens.id });
	track("api.token_created", {
		orgId,
		tokenId: row?.id,
		eventRestricted: eventId !== null,
	});
	return { created: { name: parsed.data.name, raw } };
}

async function revokeToken(db: Db, orgId: string, tokenId: string) {
	// Org scoping in the WHERE is the cross-org denial: another org's token id
	// matches no row and nothing is deleted.
	const deleted = await db
		.delete(apiTokens)
		.where(and(eq(apiTokens.id, tokenId), eq(apiTokens.organizationId, orgId)))
		.returning({ id: apiTokens.id });
	if (!deleted[0]) {
		return {
			formError: "That token no longer exists — it may already be revoked.",
		};
	}
	track("api.token_revoked", { orgId, tokenId });
	return redirect("/admin/settings/api?revoked=1");
}

export default function ApiTokens({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const navigation = useNavigation();
	const busy = navigation.state !== "idle";

	if (!loaderData.org) {
		return (
			<div className="flex flex-col gap-5">
				<PageHeader title="API tokens" />
				<Panel>
					<EmptyState
						icon="code"
						title="No organization yet"
						body="API tokens belong to an organization. Create your event to get one, or ask a teammate to invite you."
					/>
				</Panel>
			</div>
		);
	}

	const { org, tokens, events: orgEvents } = loaderData;
	const created =
		actionData && "created" in actionData ? actionData.created : null;
	const fieldErrors =
		actionData && "fieldErrors" in actionData ? actionData.fieldErrors : null;
	const formError =
		actionData && "formError" in actionData ? actionData.formError : null;

	return (
		<div className="flex flex-col gap-5">
			<PageHeader
				title="API tokens"
				count={`${tokens.length} ${tokens.length === 1 ? "token" : "tokens"}`}
				subtitle={`Tokens for ${org.name}'s read API — send one in the x-access-token header to /api/v1 endpoints. Restrict a token to one event, or leave it org-wide.`}
			/>

			{formError && <ErrorText>{formError}</ErrorText>}
			{loaderData.revoked && !created && (
				<p>Token revoked — anything that used it no longer has access.</p>
			)}

			{created && (
				<Panel>
					<div className="flex flex-col gap-2">
						<p>
							Token <strong>{created.name}</strong> created. Copy it now — for
							security, it won&apos;t be shown again.
						</p>
						<div className="flex flex-wrap items-center gap-2">
							<Input
								readOnly
								value={created.raw}
								size={44}
								aria-label="New API token"
								onFocus={(e) => e.currentTarget.select()}
							/>
							<CopyFieldButton value={created.raw} />
						</div>
					</div>
				</Panel>
			)}

			<Panel>
				{/* Keyed by the created token so a successful create remounts the
				    form with empty fields; failed validation keeps the values. */}
				<Form
					method="post"
					key={created?.raw ?? "create"}
					className="flex flex-wrap items-end gap-3"
				>
					<Field label="Token name" error={fieldErrors?.name?.[0]}>
						<Input
							name="name"
							placeholder="Website integration"
							invalid={Boolean(fieldErrors?.name?.[0])}
						/>
					</Field>
					<Field label="Access" error={fieldErrors?.eventId?.[0]}>
						<Select name="eventId" defaultValue="">
							<option value="">All events</option>
							{orgEvents.map((e) => (
								<option key={e.id} value={e.id}>
									Only {e.name}
								</option>
							))}
						</Select>
					</Field>
					<Button type="submit" icon="plus" disabled={busy}>
						Create token
					</Button>
				</Form>
			</Panel>

			{tokens.length === 0 ? (
				<Panel>
					<EmptyState
						icon="code"
						title="No API tokens yet"
						body="Create a token to read your program through the Sessionboard-compatible API — sessions, speakers, contacts, and files."
					/>
				</Panel>
			) : (
				<Table>
					<THead>
						<Th>Name</Th>
						<Th>Access</Th>
						<Th>Created</Th>
						<Th>Last used</Th>
						<Th />
					</THead>
					<TBody>
						{tokens.map((t) => (
							<Tr key={t.id}>
								<Td kind="strong">{t.name}</Td>
								<Td>{t.scope}</Td>
								<Td kind="mono">{t.createdAt}</Td>
								<Td kind="mono">{t.lastUsedAt ?? "Never"}</Td>
								<Td>
									<Form method="post" className="flex justify-end">
										<ConfirmButton
											label="Revoke"
											prompt="Anything using this token loses access immediately."
											confirmLabel="Yes, revoke token"
											name="revoke"
											value={t.id}
										/>
									</Form>
								</Td>
							</Tr>
						))}
					</TBody>
				</Table>
			)}
		</div>
	);
}

export function ErrorBoundary() {
	// Generic copy only — raw errors can carry SQL/row values.
	return (
		<PageHeader
			title="Failed to load API tokens"
			tone="danger"
			subtitle="Something went wrong. Please refresh or try again."
		/>
	);
}
