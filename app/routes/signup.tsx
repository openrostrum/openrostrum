// @public — account creation must be reachable while logged out.
import { eq } from "drizzle-orm";
import { Form, redirect, useNavigation } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { organizationMembers, users } from "~/db/schema";
import {
	createSession,
	getUser,
	hashPassword,
	homePathForRole,
	isSecureRequest,
	normalizeEmail,
} from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import { getTurnstile } from "~/ports/turnstile";
import {
	Button,
	ErrorText,
	Field,
	Input,
	Panel,
	TextLink,
	Wordmark,
} from "~/ui";
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

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await getUser(env, request);
	if (user) {
		if (user.role !== "admin") throw redirect(homePathForRole(user.role));
		const [membership] = await getDb(env)
			.select({ id: organizationMembers.id })
			.from(organizationMembers)
			.where(eq(organizationMembers.userId, user.id))
			.limit(1);
		throw redirect(membership ? "/admin" : "/onboarding");
	}
	return {};
}

export async function action({
	context,
	request,
}: Route.ActionArgs): Promise<ActionResult | Response> {
	const env = context.cloudflare.env;
	// @public route — no session required; Turnstile is the bot gate instead
	// (keyless deployments resolve to the no-op adapter by recorded decision).
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
		// decided steering message as the pre-check, never a 500.
		if (errorMessage(error).includes("UNIQUE constraint failed: users.email")) {
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

export default function Signup({ actionData }: Route.ComponentProps) {
	const busy = useNavigation().state !== "idle";
	return (
		<main className="mx-auto flex min-h-screen max-w-[360px] flex-col justify-center gap-7 px-6 py-16">
			<div className="flex justify-center">
				<Wordmark size={21} />
			</div>
			<Panel>
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
					<Field
						label="Password"
						error={actionData?.fieldErrors?.password?.[0]}
					>
						<Input
							name="password"
							type="password"
							autoComplete="new-password"
							required
							minLength={8}
							invalid={Boolean(actionData?.fieldErrors?.password?.[0])}
						/>
					</Field>
					<Button type="submit" disabled={busy}>
						Create account
					</Button>
					{actionData?.existingAccount && (
						<p>
							You already have an account —{" "}
							<TextLink to="/login">sign in</TextLink> instead.
						</p>
					)}
					{actionData?.formError && (
						<ErrorText>{actionData.formError}</ErrorText>
					)}
				</Form>
			</Panel>
			<p className="flex justify-center gap-[5px]">
				Already have an account? <TextLink to="/login">Sign in</TextLink>
			</p>
		</main>
	);
}

export function ErrorBoundary() {
	return (
		<main className="mx-auto flex min-h-screen max-w-[360px] flex-col justify-center gap-7 px-6 py-16">
			<Panel>
				<p>
					Something went wrong creating your account. Please refresh and try
					again, or <TextLink to="/login">sign in</TextLink> if you already have
					an account.
				</p>
			</Panel>
		</main>
	);
}
