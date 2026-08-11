import { and, eq, isNull, sql } from "drizzle-orm";
import { useState } from "react";
import { Form, data, redirect, useNavigation } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { organizationMembers, passwordResets, users } from "~/db/schema";
import {
	destroySession,
	mintSentinelHash,
	normalizeEmail,
	requireAdmin,
	SENTINEL_HASH_PREFIX,
} from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { type Org, resolveOrg } from "~/lib/org.server";
import { createTimings, track } from "~/lib/track";
import { getEmailSender } from "~/ports/email";
import {
	Avatar,
	Button,
	EmptyState,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Panel,
	StatusBadge,
	Table,
	TBody,
	Td,
	Th,
	THead,
	Tr,
} from "~/ui";
import type { Route } from "./+types/admin.settings.team";

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const InviteSchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(200),
	email: z.string().trim().email("Enter a valid email address"),
});

type Db = ReturnType<typeof getDb>;
type AppUser = typeof users.$inferSelect;

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

// (Re)mints the invite token — run in ONE batch (with the user insert when the
// account is new) so a failure can never strand a token-less sentinel. Old
// unused tokens die first; `organizationId` on the token is the mint-time
// intent the accept flow derives the membership grant from.
function inviteTokenStatements(
	db: Db,
	org: Org,
	userId: string,
	token: string,
) {
	return [
		db
			.delete(passwordResets)
			.where(
				and(
					eq(passwordResets.userId, userId),
					eq(passwordResets.organizationId, org.id),
					isNull(passwordResets.usedAt),
				),
			),
		db.insert(passwordResets).values({
			userId,
			organizationId: org.id,
			token,
			expiresAt: new Date(Date.now() + INVITE_TTL_MS),
		}),
	] as const;
}

async function sendInviteEmail(
	env: Env,
	org: Org,
	invitee: { id: string; email: string },
	inviterName: string,
	origin: string,
	token: string,
): Promise<{ emailFailed: boolean }> {
	const link = `${origin}/set-password/${token}`;
	let emailFailed = false;
	try {
		await getEmailSender(env).send({
			to: invitee.email,
			subject: `You've been invited to join ${org.name} on OpenRostrum`,
			html: [
				`<p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(org.name)}</strong> on OpenRostrum.</p>`,
				`<p><a href="${link}">Accept the invite and set your password</a></p>`,
				"<p>This link expires in 7 days. If you weren't expecting this, you can ignore it.</p>",
			].join(""),
			dedupeKey: `org_invite:${token}`,
		});
	} catch (error) {
		emailFailed = true;
		track("team.invite_email_failed", {
			orgId: org.id,
			invitedUserId: invitee.id,
			error: errorMessage(error),
		});
	}
	track("team.invited", {
		orgId: org.id,
		invitedUserId: invitee.id,
		emailFailed,
	});
	return { emailFailed };
}

function invitedRedirect(email: string, emailFailed: boolean) {
	const params = new URLSearchParams({ invited: email });
	if (emailFailed) params.set("email", "failed");
	return redirect(`/admin/settings/team?${params}`);
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const org = await resolveOrg(env, user);
	const url = new URL(request.url);
	const invitedEmail = url.searchParams.get("invited");
	const inviteEmailFailed = url.searchParams.get("email") === "failed";
	if (!org) {
		return data({
			org: null,
			members: [],
			invites: [],
			me: user.id,
			invitedEmail,
			inviteEmailFailed,
		});
	}
	const db = getDb(env);
	const timings = createTimings();
	const { members, inviteRows } = await timings.time("db", async () => ({
		members: await db
			.select({
				membershipId: organizationMembers.id,
				userId: users.id,
				name: users.name,
				email: users.email,
				joinedAt: organizationMembers.createdAt,
			})
			.from(organizationMembers)
			.innerJoin(users, eq(users.id, organizationMembers.userId))
			.where(eq(organizationMembers.organizationId, org.id))
			.orderBy(organizationMembers.createdAt),
		inviteRows: await db
			.select({
				id: passwordResets.id,
				token: passwordResets.token,
				expiresAt: passwordResets.expiresAt,
				createdAt: passwordResets.createdAt,
				userId: users.id,
				name: users.name,
				email: users.email,
			})
			.from(passwordResets)
			.innerJoin(users, eq(users.id, passwordResets.userId))
			.where(
				and(
					eq(passwordResets.organizationId, org.id),
					isNull(passwordResets.usedAt),
				),
			)
			.orderBy(passwordResets.createdAt),
	}));
	const memberIds = new Set(members.map((m) => m.userId));
	const now = Date.now();
	const invites = inviteRows
		// Display hygiene only: hides a row whose accept raced between the two
		// queries above; every reachable path already voids such tokens.
		.filter((i) => !memberIds.has(i.userId))
		.map(({ token, ...i }) => ({
			...i,
			expired: i.expiresAt.getTime() <= now,
			link: `${url.origin}/set-password/${token}`,
		}));
	return data(
		{
			org: { id: org.id, name: org.name },
			members,
			invites,
			me: user.id,
			invitedEmail,
			inviteEmailFailed,
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Actions self-authenticate — a POST never runs the layout loader.
	const user = await requireAdmin(env, request);
	const org = await resolveOrg(env, user);
	const db = getDb(env);
	const form = await request.formData();
	const origin = new URL(request.url).origin;

	if (!org) {
		return {
			fieldErrors: undefined,
			formError:
				"You aren't a member of an organization yet, so there is no team to manage.",
		};
	}

	const timings = createTimings();
	try {
		// Buttons carry the row id as their value (`remove`/`revoke`/`resend`);
		// the plain invite form is the default. Dispatch is key-presence.
		const result = await timings.time("db", async () => {
			if (form.has("remove")) {
				return removeMember(env, db, org, user, request, {
					membershipId: String(form.get("remove")),
				});
			}
			if (form.has("revoke")) {
				return revokeInvite(db, org, String(form.get("revoke")));
			}
			if (form.has("resend")) {
				return resendInvite(
					env,
					db,
					org,
					user,
					origin,
					String(form.get("resend")),
				);
			}
			return inviteMember(env, db, org, user, origin, form);
		});
		if (result instanceof Response) {
			result.headers.append("Server-Timing", timings.header());
		}
		return result;
	} catch (error) {
		// Log the detail server-side; never leak SQL / row values into the UI.
		track("team.action_failed", { orgId: org.id, error: errorMessage(error) });
		return {
			fieldErrors: undefined,
			formError: "Something went wrong — please try again.",
		};
	}
}

async function inviteMember(
	env: Env,
	db: Db,
	org: Org,
	inviter: AppUser,
	origin: string,
	form: FormData,
) {
	const parsed = InviteSchema.safeParse({
		name: form.get("name"),
		email: form.get("email"),
	});
	if (!parsed.success) {
		return {
			fieldErrors: z.flattenError(parsed.error).fieldErrors,
			formError: undefined,
		};
	}
	const email = normalizeEmail(parsed.data.email);
	const token = crypto.randomUUID();
	const [existing] = await db
		.select()
		.from(users)
		.where(eq(users.email, email))
		.limit(1);

	let invitee: { id: string; email: string; name: string | null };
	if (existing) {
		const [member] = await db
			.select({ id: organizationMembers.id })
			.from(organizationMembers)
			.where(
				and(
					eq(organizationMembers.organizationId, org.id),
					eq(organizationMembers.userId, existing.id),
				),
			)
			.limit(1);
		if (member) {
			return {
				fieldErrors: {
					email: [`${email} is already a member of ${org.name}.`],
				},
				formError: undefined,
			};
		}
		// The on-screen link resets the account password on redeem — minting one
		// for a credentialed account would be takeover. Only the sentinel marker
		// (= never had a usable credential) may be re-invited; that is a resend.
		if (!existing.passwordHash.startsWith(SENTINEL_HASH_PREFIX)) {
			return {
				fieldErrors: {
					email: [
						"This email already has an OpenRostrum account, so it can't be invited from here yet — organization access for existing accounts arrives with account linking.",
					],
				},
				formError: undefined,
			};
		}
		invitee = existing;
		await db.batch([...inviteTokenStatements(db, org, existing.id, token)]);
	} else {
		const userId = crypto.randomUUID();
		// One batch: a failure between user insert and token mint must never
		// strand a credential-less account that blocks re-inviting this email.
		await db.batch([
			db.insert(users).values({
				id: userId,
				email,
				name: parsed.data.name,
				role: "admin",
				passwordHash: mintSentinelHash(),
			}),
			...inviteTokenStatements(db, org, userId, token),
		]);
		invitee = { id: userId, email, name: parsed.data.name };
	}

	const { emailFailed } = await sendInviteEmail(
		env,
		org,
		invitee,
		inviter.name ?? inviter.email,
		origin,
		token,
	);
	return invitedRedirect(email, emailFailed);
}

async function resendInvite(
	env: Env,
	db: Db,
	org: Org,
	inviter: AppUser,
	origin: string,
	inviteId: string,
) {
	const [row] = await db
		.select({ id: users.id, email: users.email, name: users.name })
		.from(passwordResets)
		.innerJoin(users, eq(users.id, passwordResets.userId))
		.where(
			and(
				eq(passwordResets.id, inviteId),
				eq(passwordResets.organizationId, org.id),
				isNull(passwordResets.usedAt),
			),
		)
		.limit(1);
	if (!row) {
		return {
			fieldErrors: undefined,
			formError: "That invite no longer exists — it may have been accepted.",
		};
	}
	const token = crypto.randomUUID();
	await db.batch([...inviteTokenStatements(db, org, row.id, token)]);
	const { emailFailed } = await sendInviteEmail(
		env,
		org,
		row,
		inviter.name ?? inviter.email,
		origin,
		token,
	);
	return invitedRedirect(row.email, emailFailed);
}

async function revokeInvite(db: Db, org: Org, inviteId: string) {
	const [invite] = await db
		.select({ id: passwordResets.id, userId: passwordResets.userId })
		.from(passwordResets)
		.where(
			and(
				eq(passwordResets.id, inviteId),
				eq(passwordResets.organizationId, org.id),
				isNull(passwordResets.usedAt),
			),
		)
		.limit(1);
	if (!invite) {
		return {
			fieldErrors: undefined,
			formError: "That invite no longer exists — it may have been accepted.",
		};
	}
	// One batch: also garbage-collect the sentinel account (marker = never had
	// a usable credential) once no other invite references it — an orphaned row
	// would read as "an existing account" and block re-inviting this email.
	await db.batch([
		db.delete(passwordResets).where(eq(passwordResets.id, invite.id)),
		db
			.delete(users)
			.where(
				and(
					eq(users.id, invite.userId),
					sql`${users.passwordHash} LIKE ${`${SENTINEL_HASH_PREFIX}%`}`,
					sql`NOT EXISTS (SELECT 1 FROM password_resets pr WHERE pr.user_id = users.id AND pr.used_at IS NULL)`,
				),
			),
	]);
	track("team.invite_revoked", { orgId: org.id, inviteId });
	return redirect("/admin/settings/team");
}

async function removeMember(
	env: Env,
	db: Db,
	org: Org,
	actor: AppUser,
	request: Request,
	{ membershipId }: { membershipId: string },
) {
	// The last-member invariant rides the DELETE itself — atomic, so two
	// concurrent removals can't empty the org (D1 has no transactions). The
	// org scoping in the WHERE is also the cross-org denial.
	const deleted = await db
		.delete(organizationMembers)
		.where(
			and(
				eq(organizationMembers.id, membershipId),
				eq(organizationMembers.organizationId, org.id),
				sql`(SELECT COUNT(*) FROM organization_members om2 WHERE om2.organization_id = ${org.id}) > 1`,
			),
		)
		.returning({ userId: organizationMembers.userId });
	const removed = deleted[0];
	if (!removed) {
		// Distinguish the two refusals only to word the message — enforcement
		// already happened atomically above.
		const [target] = await db
			.select({ id: organizationMembers.id })
			.from(organizationMembers)
			.where(
				and(
					eq(organizationMembers.id, membershipId),
					eq(organizationMembers.organizationId, org.id),
				),
			)
			.limit(1);
		return {
			fieldErrors: undefined,
			formError: target
				? `${org.name} must keep at least one member — invite someone else before removing the last one.`
				: "That member wasn't found in this organization.",
		};
	}
	track("team.member_removed", {
		orgId: org.id,
		removedUserId: removed.userId,
		self: removed.userId === actor.id,
	});
	if (removed.userId === actor.id) {
		const cookie = await destroySession(env, request);
		return redirect("/login", { headers: { "Set-Cookie": cookie } });
	}
	return redirect("/admin/settings/team");
}

function InviteLink({ id, link }: { id: string; link: string }) {
	const [copied, setCopied] = useState(false);
	const inputId = `invite-link-${id}`;
	return (
		<div className="flex items-center gap-2">
			<Input
				id={inputId}
				readOnly
				value={link}
				size={42}
				aria-label="Invite link"
				onFocus={(e) => e.currentTarget.select()}
			/>
			<Button
				type="button"
				variant="ghost"
				onClick={async () => {
					try {
						await navigator.clipboard.writeText(link);
						setCopied(true);
						setTimeout(() => setCopied(false), 2000);
					} catch {
						// Clipboard is unavailable on insecure origins — select the
						// text so a manual copy still works.
						const el = document.getElementById(inputId);
						if (el instanceof HTMLInputElement) el.select();
					}
				}}
			>
				{copied ? "Copied" : "Copy link"}
			</Button>
		</div>
	);
}

const joinedFormat = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
});

export default function Team({ loaderData, actionData }: Route.ComponentProps) {
	const { org, members, invites, me, invitedEmail, inviteEmailFailed } =
		loaderData;
	const navigation = useNavigation();
	const busy = navigation.state !== "idle";
	const [confirming, setConfirming] = useState<string | null>(null);

	if (!org) {
		return (
			<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
				<PageHeader title="Team" />
				<Panel>
					<EmptyState
						icon="sliders"
						title="No organization yet"
						body="You aren't a member of an organization, so there is no team to manage. Ask a teammate to invite you from their Team settings."
					/>
				</Panel>
			</div>
		);
	}

	return (
		<div className="mx-auto flex max-w-5xl flex-col gap-5 px-7 py-6">
			<PageHeader
				title="Team"
				count={`${members.length} ${members.length === 1 ? "member" : "members"}`}
				subtitle={`Members of ${org.name}. Every member is an equal admin — anyone can invite or remove teammates.`}
			/>

			{actionData?.formError && <ErrorText>{actionData.formError}</ErrorText>}

			<Panel>
				{/* Keyed by the last invited email so a successful invite remounts
				    the form with empty fields; failed validation keeps the values. */}
				<Form
					method="post"
					key={invitedEmail ?? "invite"}
					className="flex flex-wrap items-end gap-3"
				>
					<Field label="Name" error={actionData?.fieldErrors?.name?.[0]}>
						<Input
							name="name"
							placeholder="Jordan Organizer"
							invalid={Boolean(actionData?.fieldErrors?.name?.[0])}
						/>
					</Field>
					<Field label="Email" error={actionData?.fieldErrors?.email?.[0]}>
						<Input
							name="email"
							type="email"
							placeholder="teammate@conference.org"
							invalid={Boolean(actionData?.fieldErrors?.email?.[0])}
						/>
					</Field>
					<Button type="submit" icon="plus" disabled={busy}>
						Invite teammate
					</Button>
				</Form>
				{invitedEmail && (
					<p className="mt-3">
						Invite ready for {invitedEmail}.{" "}
						{inviteEmailFailed
							? "The invite email could not be sent — copy the link below and share it directly."
							: "An email is on its way — you can also copy the invite link below."}
					</p>
				)}
			</Panel>

			{invites.length > 0 && (
				<Table>
					<THead>
						<Th>Pending invite</Th>
						<Th>Status</Th>
						<Th>Invite link</Th>
						<Th />
					</THead>
					<TBody>
						{invites.map((inv) => (
							<Tr key={inv.id}>
								<Td kind="strong">
									<div className="flex flex-col">
										<span>{inv.name ?? inv.email}</span>
										{inv.name && <span>{inv.email}</span>}
									</div>
								</Td>
								<Td>
									<StatusBadge tone={inv.expired ? "neutral" : "info"}>
										{inv.expired ? "Expired" : "Pending"}
									</StatusBadge>
								</Td>
								<Td>
									<InviteLink id={inv.id} link={inv.link} />
								</Td>
								<Td>
									<div className="flex items-center gap-2">
										<Form method="post">
											<Button
												type="submit"
												variant="ghost"
												name="resend"
												value={inv.id}
												disabled={busy}
											>
												Resend
											</Button>
										</Form>
										<Form method="post">
											<Button
												type="submit"
												variant="ghost"
												name="revoke"
												value={inv.id}
												disabled={busy}
											>
												Revoke
											</Button>
										</Form>
									</div>
								</Td>
							</Tr>
						))}
					</TBody>
				</Table>
			)}

			<Table>
				<THead>
					<Th>Member</Th>
					<Th>Email</Th>
					<Th>Joined</Th>
					<Th />
				</THead>
				<TBody>
					{members.map((m) => (
						<Tr key={m.membershipId}>
							<Td kind="strong">
								<div className="flex items-center gap-2">
									<Avatar name={m.name ?? m.email} />
									<span>{m.name ?? "—"}</span>
									{m.userId === me && (
										<StatusBadge tone="faint">You</StatusBadge>
									)}
								</div>
							</Td>
							<Td>{m.email}</Td>
							<Td kind="mono">{joinedFormat.format(new Date(m.joinedAt))}</Td>
							<Td>
								{confirming === m.membershipId ? (
									<Form method="post" className="flex items-center gap-2">
										<Button
											type="submit"
											name="remove"
											value={m.membershipId}
											disabled={busy}
										>
											{m.userId === me
												? "Yes, leave organization"
												: "Yes, remove member"}
										</Button>
										<Button
											type="button"
											variant="ghost"
											onClick={() => setConfirming(null)}
										>
											Cancel
										</Button>
									</Form>
								) : (
									<Button
										type="button"
										variant="ghost"
										onClick={() => setConfirming(m.membershipId)}
									>
										{m.userId === me ? "Leave" : "Remove"}
									</Button>
								)}
							</Td>
						</Tr>
					))}
				</TBody>
			</Table>
		</div>
	);
}

export function ErrorBoundary() {
	return (
		<div className="mx-auto max-w-5xl px-7 py-6">
			<PageHeader
				title="Failed to load the team page"
				tone="danger"
				subtitle="Something went wrong. Please refresh or try again."
			/>
		</div>
	);
}
