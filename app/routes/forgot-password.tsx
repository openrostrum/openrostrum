// @public — password recovery must be reachable logged out.
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { Form } from "react-router";
import { z } from "zod";
import { AuthNote, AuthPage } from "~/marketing/auth";
import { getDb } from "~/db";
import { passwordResets, users } from "~/db/schema";
import { hashPassword, normalizeEmail } from "~/lib/auth";
import { escapeHtml } from "~/lib/email-render";
import { errorMessage } from "~/lib/errors";
import { getEmailSender } from "~/ports/email";
import { track } from "~/lib/track";
import { Button, ErrorText, Field, Input, TextLink } from "~/ui";
import type { Route } from "./+types/forgot-password";

const RequestReset = z.object({
	email: z.string().email("Enter a valid email address"),
});

const RESET_TTL_MS = 1000 * 60 * 60; // 1 hour
const RESEND_THROTTLE_MS = 1000 * 60 * 5; // blunts inbox-bombing a victim

export function meta(_: Route.MetaArgs) {
	return [{ title: "Reset your password — OpenRostrum" }];
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const form = await request.formData();
	const parsed = RequestReset.safeParse({ email: form.get("email") });
	if (!parsed.success) {
		return {
			fieldError: z.flattenError(parsed.error).fieldErrors.email?.[0],
			formError: undefined,
			sent: false as const,
			email: "",
		};
	}
	const email = normalizeEmail(parsed.data.email);
	const db = getDb(env);
	const [user] = await db
		.select({ id: users.id, email: users.email })
		.from(users)
		.where(eq(users.email, email))
		.limit(1);

	try {
		if (user) {
			const [recent] = await db
				.select({ id: passwordResets.id })
				.from(passwordResets)
				.where(
					and(
						eq(passwordResets.userId, user.id),
						isNull(passwordResets.usedAt),
						gt(
							passwordResets.createdAt,
							new Date(Date.now() - RESEND_THROTTLE_MS),
						),
					),
				)
				.orderBy(desc(passwordResets.createdAt))
				.limit(1);
			if (!recent) {
				const token = crypto.randomUUID();
				const [reset] = await db
					.insert(passwordResets)
					.values({
						userId: user.id,
						organizationId: null, // plain password reset, not an org invite
						token,
						expiresAt: new Date(Date.now() + RESET_TTL_MS),
					})
					.returning({ id: passwordResets.id });
				const link = `${new URL(request.url).origin}/set-password/${token}`;
				await getEmailSender(env).send({
					to: user.email,
					subject: "Reset your OpenRostrum password",
					html: `<p>Someone (hopefully you) asked to reset the password for ${escapeHtml(user.email)}.</p><p><a href="${link}">Choose a new password</a> — the link expires in one hour.</p><p>If you didn't request this, you can ignore this email; your password is unchanged.</p>`,
					kind: "transactional", // account email — delivers even to unsubscribed addresses
					dedupeKey: `password_reset:${reset?.id ?? token}`,
				});
				track("password_reset.requested", { userId: user.id });
			}
		} else {
			// Burn comparable CPU so response timing doesn't reveal whether the
			// account exists (same trick as the login route's dummy verify).
			await hashPassword(crypto.randomUUID());
			track("password_reset.requested", { userId: null });
		}
	} catch (error) {
		track("password_reset.failed", { error: errorMessage(error) });
		return {
			fieldError: undefined,
			formError: "Could not send the reset email — please try again.",
			sent: false as const,
			email: "",
		};
	}

	// Identical response whether or not the account exists — the page must
	// never disclose which addresses have accounts.
	return {
		fieldError: undefined,
		formError: undefined,
		sent: true as const,
		email,
	};
}

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
	if (actionData?.sent) {
		return (
			<AuthPage
				title="Check your inbox"
				nav={{
					prompt: "New to OpenRostrum?",
					label: "Create your account",
					to: "/signup",
				}}
				below={<TextLink to="/login">Back to sign in</TextLink>}
			>
				<AuthNote>
					If an account exists for {actionData.email}, a password-reset link is
					on its way. The link expires in one hour.
				</AuthNote>
			</AuthPage>
		);
	}
	return (
		<AuthPage
			title="Forgot your password?"
			subtitle="Enter your account email and we'll send you a link to choose a new one."
			nav={{
				prompt: "New to OpenRostrum?",
				label: "Create your account",
				to: "/signup",
			}}
			below={<TextLink to="/login">Back to sign in</TextLink>}
		>
			<Form method="post" className="flex flex-col gap-[13px]">
				<Field label="Email" error={actionData?.fieldError}>
					<Input
						name="email"
						type="email"
						required
						placeholder="you@conference.org"
						invalid={Boolean(actionData?.fieldError)}
					/>
				</Field>
				<Button type="submit">Send reset link</Button>
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
			below={<TextLink to="/login">Back to sign in</TextLink>}
		>
			<AuthNote>Please refresh and try again.</AuthNote>
		</AuthPage>
	);
}
