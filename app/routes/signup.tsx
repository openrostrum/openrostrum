// @public — account creation must be reachable while logged out.
import { eq } from "drizzle-orm";
import { Form, redirect } from "react-router";
import { z } from "zod";
import { AuthNote, AuthPage } from "~/marketing/auth";
import { getDb } from "~/db";
import { users } from "~/db/schema";
import {
	createSession,
	getUser,
	hashPassword,
	isSecureRequest,
	normalizeEmail,
} from "~/lib/auth";
import { TurnstileWidget } from "~/cfp/ui";
import { errorChainIncludes, errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import { getTurnstile } from "~/ports/turnstile";
import { Button, ErrorText, Field, Input, TextLink } from "~/ui";
import type { Route } from "./+types/signup";

const SignupForm = z.object({
	name: z.string().trim().min(1, "Your name is required").max(200),
	email: z
		.string()
		.trim()
		.email("Enter a valid email address")
		.max(254, "Email is too long"),
	// Upper bound keeps PBKDF2 cost bounded (hashing is per-byte work).
	password: z
		.string()
		.min(8, "Use at least 8 characters")
		.max(200, "Password is too long"),
});

type ActionResult = {
	fieldErrors?: Partial<Record<"name" | "email" | "password", string[]>>;
	formError?: string;
	/** Decided path: an email that already has an account steers to /login. */
	existingAccount?: boolean;
	/** Echoed (password excluded) so a full-document error response
	 * (no-JS fallback) re-renders the form filled in instead of wiped. */
	values?: { name: string; email: string };
};

export function meta(_: Route.MetaArgs) {
	return [{ title: "Create your account — OpenRostrum" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	// Signed-in visitors go to /onboarding, whose access gate owns the
	// member/role routing — one home for that knowledge, not two.
	if (await getUser(env, request)) throw redirect("/onboarding");
	return { turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null };
}

export async function action({
	context,
	request,
}: Route.ActionArgs): Promise<ActionResult | Response> {
	const env = context.cloudflare.env;
	// @public route — no session required. The Turnstile token is verified
	// through the port; a keyless deployment resolves to the no-op adapter.
	const form = await request.formData();
	const values = {
		name: String(form.get("name") ?? ""),
		email: String(form.get("email") ?? ""),
	};
	const turnstileOk = await getTurnstile(env).verify(
		String(form.get("cf-turnstile-response") ?? ""),
		request.headers.get("CF-Connecting-IP") ?? undefined,
	);
	if (!turnstileOk) {
		track("signup.turnstile_failed", {});
		return {
			formError: "We couldn't verify you're human — please try again.",
			values,
		};
	}

	const parsed = SignupForm.safeParse({
		...values,
		password: form.get("password"),
	});
	if (!parsed.success) {
		return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
	}

	const db = getDb(env);
	const email = normalizeEmail(parsed.data.email);
	const [existing] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, email))
		.limit(1);
	if (existing) {
		track("signup.existing_email", {});
		return { existingAccount: true, values };
	}

	const userId = crypto.randomUUID();
	const passwordHash = await hashPassword(parsed.data.password);
	const timings = createTimings();
	try {
		await timings.time("db", () =>
			db.insert(users).values({
				id: userId,
				email,
				name: parsed.data.name,
				passwordHash,
				role: "admin",
			}),
		);
	} catch (error) {
		// Race with a concurrent signup for the same email lands here — same
		// decided steering message as the pre-check, never a 500. Drizzle wraps
		// the D1 constraint error, so the check walks the cause chain.
		if (errorChainIncludes(error, "UNIQUE constraint failed: users.email")) {
			track("signup.existing_email", {});
			return { existingAccount: true, values };
		}
		track("signup.create_failed", { error: errorMessage(error) });
		return {
			formError: "Could not create your account — please try again.",
			values,
		};
	}

	track("signup.created", { userId });
	const cookie = await createSession(env, userId, isSecureRequest(request));
	return redirect("/onboarding", {
		headers: { "Set-Cookie": cookie, "Server-Timing": timings.header() },
	});
}

export default function Signup({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const busy = useBusy();
	return (
		<AuthPage
			title="Create your account"
			subtitle="Set up your organization and run your conference's program here — free and open source."
			nav={{
				prompt: "Already have an account?",
				label: "Sign in",
				to: "/login",
			}}
		>
			<Form method="post" className="flex flex-col gap-[13px]">
				<Field label="Name" error={actionData?.fieldErrors?.name?.[0]}>
					<Input
						name="name"
						autoComplete="name"
						required
						placeholder="Alex Rivera"
						defaultValue={actionData?.values?.name}
						invalid={Boolean(actionData?.fieldErrors?.name?.[0])}
					/>
				</Field>
				<Field label="Email" error={actionData?.fieldErrors?.email?.[0]}>
					<Input
						name="email"
						type="email"
						autoComplete="email"
						required
						placeholder="you@conference.org"
						defaultValue={actionData?.values?.email}
						invalid={Boolean(actionData?.fieldErrors?.email?.[0])}
					/>
				</Field>
				<Field label="Password" error={actionData?.fieldErrors?.password?.[0]}>
					<Input
						name="password"
						type="password"
						autoComplete="new-password"
						required
						minLength={8}
						invalid={Boolean(actionData?.fieldErrors?.password?.[0])}
					/>
				</Field>
				<TurnstileWidget
					siteKey={loaderData.turnstileSiteKey}
					resetSignal={actionData}
				/>
				<Button type="submit" disabled={busy} aria-busy={busy}>
					{busy ? "Creating account…" : "Create account"}
				</Button>
				{actionData?.existingAccount && (
					<div role="alert">
						<ErrorText>
							You already have an account —{" "}
							<TextLink to="/login">sign in</TextLink> instead.
						</ErrorText>
					</div>
				)}
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
			nav={{
				prompt: "Already have an account?",
				label: "Sign in",
				to: "/login",
			}}
		>
			<AuthNote>
				Something went wrong creating your account. Please refresh and try
				again, or <TextLink to="/login">sign in</TextLink> if you already have
				an account.
			</AuthNote>
		</AuthPage>
	);
}
