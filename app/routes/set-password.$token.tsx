// @public — the invite / password-reset landing; it must work logged out.
import { and, eq, isNull, ne } from "drizzle-orm";
import { Form, data, redirect } from "react-router";
import { z } from "zod";
import { AuthNote, AuthPage } from "~/marketing/auth";
import { getDb } from "~/db";
import {
	authSessions,
	events,
	organizationMembers,
	organizations,
	passwordResets,
	users,
} from "~/db/schema";
import {
	createSession,
	hashPassword,
	homePathForRole,
	isSecureRequest,
} from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import { Button, ErrorText, Field, Input, TextLink } from "~/ui";
import type { Route } from "./+types/set-password.$token";

const PasswordSchema = z
	.object({
		password: z.string().min(8, "Use at least 8 characters."),
		confirm: z.string(),
	})
	.refine((d) => d.password === d.confirm, {
		path: ["confirm"],
		message: "Passwords don't match.",
	});

async function lookupToken(env: Env, token: string) {
	const db = getDb(env);
	const [row] = await db
		.select({
			reset: passwordResets,
			user: users,
			orgName: organizations.name,
		})
		.from(passwordResets)
		.innerJoin(users, eq(users.id, passwordResets.userId))
		.leftJoin(
			organizations,
			eq(organizations.id, passwordResets.organizationId),
		)
		.where(eq(passwordResets.token, token))
		.limit(1);
	if (!row || row.reset.usedAt || row.reset.expiresAt.getTime() <= Date.now())
		return null;
	return row;
}

export function meta(_: Route.MetaArgs) {
	return [{ title: "Set your password — OpenRostrum" }];
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, params }: Route.LoaderArgs) {
	const timings = createTimings();
	const row = await timings.time("db", () =>
		lookupToken(context.cloudflare.env, params.token),
	);
	const headers = { "Server-Timing": timings.header() };
	if (!row) return data({ state: "invalid" as const }, { headers });
	return data(
		{
			state: "valid" as const,
			email: row.user.email,
			orgName: row.orgName,
		},
		{ headers },
	);
}

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const db = getDb(env);
	const row = await lookupToken(env, params.token);
	if (!row) {
		return {
			fieldErrors: undefined,
			formError:
				"This link is invalid, already used, or expired. Ask for a new one.",
		};
	}

	const form = await request.formData();
	const parsed = PasswordSchema.safeParse({
		password: form.get("password"),
		confirm: form.get("confirm"),
	});
	if (!parsed.success) {
		return {
			fieldErrors: z.flattenError(parsed.error).fieldErrors,
			formError: undefined,
		};
	}

	const passwordHash = await hashPassword(parsed.data.password);
	const setPassword = db
		.update(users)
		.set({ passwordHash })
		.where(eq(users.id, row.user.id));
	const consumeToken = db
		.update(passwordResets)
		.set({ usedAt: new Date() })
		.where(eq(passwordResets.id, row.reset.id));
	// A credential change invalidates every existing session for the account.
	const revokeSessions = db
		.delete(authSessions)
		.where(eq(authSessions.userId, row.user.id));
	// ...and every OTHER outstanding token: an old invite/reset link must not
	// survive a password change, or its holder could later re-take the account.
	const dropOtherTokens = db
		.delete(passwordResets)
		.where(
			and(
				eq(passwordResets.userId, row.user.id),
				ne(passwordResets.id, row.reset.id),
				isNull(passwordResets.usedAt),
			),
		);

	const timings = createTimings();
	try {
		// The token's organizationId is its mint-time intent: a membership is
		// created because that column is set — NEVER because of which route
		// redeemed the token. A speaker/reviewer/reset token (NULL) must never
		// produce one, or a co-speaker invite could escalate to org admin.
		if (row.reset.organizationId) {
			const orgId = row.reset.organizationId;
			await timings.time("db", async () => {
				const [firstEvent] = await db
					.select({ id: events.id })
					.from(events)
					.where(eq(events.organizationId, orgId))
					.orderBy(events.createdAt)
					.limit(1);
				await db.batch([
					setPassword,
					consumeToken,
					revokeSessions,
					dropOtherTokens,
					db
						.insert(organizationMembers)
						.values({ organizationId: orgId, userId: row.user.id })
						.onConflictDoNothing(),
					...(firstEvent
						? [
								db
									.update(users)
									.set({ activeEventId: firstEvent.id })
									.where(eq(users.id, row.user.id)),
							]
						: []),
				]);
			});
			track("team.member_joined", { orgId, userId: row.user.id });
		} else {
			await timings.time("db", () =>
				db.batch([setPassword, consumeToken, revokeSessions, dropOtherTokens]),
			);
		}
	} catch (error) {
		track("auth.password_set_failed", {
			userId: row.user.id,
			error: errorMessage(error),
		});
		return {
			fieldErrors: undefined,
			formError: "Could not set the password — please try again.",
		};
	}

	track("auth.password_set", {
		userId: row.user.id,
		orgIntent: Boolean(row.reset.organizationId),
	});
	const cookie = await createSession(
		env,
		row.user.id,
		isSecureRequest(request),
	);
	const dest = row.reset.organizationId
		? "/admin"
		: homePathForRole(row.user.role);
	return redirect(dest, {
		headers: { "Set-Cookie": cookie, "Server-Timing": timings.header() },
	});
}

export default function SetPassword({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const busy = useBusy();

	if (loaderData.state === "invalid") {
		return (
			<AuthPage
				title="This link doesn't work"
				tone="danger"
				nav={{
					prompt: "Already have an account?",
					label: "Sign in",
					to: "/login",
				}}
				below={
					<>
						<TextLink to="/forgot-password">Request a new reset link</TextLink>
						<TextLink to="/login">Go to sign in</TextLink>
					</>
				}
			>
				<AuthNote>
					It is invalid, already used, or expired. Ask whoever sent it to send a
					fresh one.
				</AuthNote>
			</AuthPage>
		);
	}

	return (
		<AuthPage
			title={
				loaderData.orgName ? `Join ${loaderData.orgName}` : "Set your password"
			}
			subtitle={
				loaderData.orgName
					? `You've been invited to ${loaderData.orgName}. Set a password to finish creating your account.`
					: "Choose a new password for your account."
			}
			nav={{
				prompt: "Already have an account?",
				label: "Sign in",
				to: "/login",
			}}
		>
			<Form method="post" className="flex flex-col gap-[13px]">
				<Field label="Email">
					<Input
						name="email"
						type="email"
						value={loaderData.email}
						readOnly
						autoComplete="username"
					/>
				</Field>
				<Field
					label="New password"
					error={actionData?.fieldErrors?.password?.[0]}
				>
					<Input
						name="password"
						type="password"
						required
						minLength={8}
						autoComplete="new-password"
						invalid={Boolean(actionData?.fieldErrors?.password?.[0])}
					/>
				</Field>
				<Field
					label="Confirm password"
					error={actionData?.fieldErrors?.confirm?.[0]}
				>
					<Input
						name="confirm"
						type="password"
						required
						autoComplete="new-password"
						invalid={Boolean(actionData?.fieldErrors?.confirm?.[0])}
					/>
				</Field>
				<Button type="submit" disabled={busy}>
					{loaderData.orgName ? "Set password & join" : "Set password"}
				</Button>
				{actionData?.formError && (
					<div role="alert">
						<ErrorText>{actionData.formError}</ErrorText>
					</div>
				)}
			</Form>
		</AuthPage>
	);
}

export function ErrorBoundary() {
	return (
		<AuthPage
			title="Something went wrong"
			tone="danger"
			below={<TextLink to="/login">Go to sign in</TextLink>}
		>
			<AuthNote>Please reload the page or ask for a fresh link.</AuthNote>
		</AuthPage>
	);
}
