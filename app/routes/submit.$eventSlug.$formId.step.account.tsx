// @public — the wizard's account step: inline sign-in / sign-up for speakers.
import { and, eq, isNull } from "drizzle-orm";
import { data, Form, redirect, useRouteLoaderData } from "react-router";
import { z } from "zod";
import { isFormClosed, linkUserToContacts, loadPublicForm } from "~/cfp/server";
import { Checkbox, MutedText, PageTitle, TurnstileWidget } from "~/cfp/ui";
import { stepPath, submitBasePath } from "~/cfp/wizard";
import { getDb } from "~/db";
import { contacts, users } from "~/db/schema";
import {
	createSession,
	destroySession,
	hashPassword,
	isSecureRequest,
	normalizeEmail,
	verifyPasswordTimingEqual,
} from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import { systemClock } from "~/ports/clock";
import { getTurnstile } from "~/ports/turnstile";
import {
	Button,
	ButtonLink,
	ErrorText,
	Field,
	Input,
	Panel,
	TextLink,
} from "~/ui";
import type { Route } from "./+types/submit.$eventSlug.$formId.step.account";
import type { Route as LayoutRoute } from "./+types/submit.$eventSlug.$formId";

const EmailOnly = z.object({
	email: z.string().email("Enter a valid email address."),
});

const Signup = z.object({
	email: z.string().email("Enter a valid email address."),
	firstName: z.string().trim().min(1, "First name is required").max(255),
	lastName: z.string().trim().min(1, "Last name is required").max(255),
	password: z
		.string()
		.min(8, "Use at least 8 characters")
		.regex(/[A-Z]/, "Include at least one capital letter")
		.regex(/\d/, "Include at least one number")
		.regex(/[^A-Za-z0-9]/, "Include at least one special character"),
	terms: z.literal("on", {
		error: "Please accept the terms to create your account.",
	}),
});

export async function loader({ context }: Route.LoaderArgs) {
	return {
		turnstileSiteKey: context.cloudflare.env.TURNSTILE_SITE_KEY ?? null,
	};
}

type ActionResult = {
	branch: "email" | "login" | "signup";
	email: string;
	error?: string;
	fieldErrors?: Record<string, string>;
};

export async function action({ context, request, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const db = getDb(env);
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");
	const base = submitBasePath(params.eventSlug, params.formId);

	if (intent === "logout") {
		const clearCookie = await destroySession(env, request);
		return redirect(base, { headers: { "Set-Cookie": clearCookie } });
	}

	const bundle = await loadPublicForm(env, params.eventSlug, params.formId);
	if (!bundle) throw data("Form not found", { status: 404 });
	if (isFormClosed(bundle.form, systemClock.now())) {
		throw data(
			{ error: "This form is no longer accepting submissions." },
			{ status: 403 },
		);
	}

	const email = normalizeEmail(String(form.get("email") ?? ""));

	if (intent === "lookup") {
		const parsed = EmailOnly.safeParse({ email });
		if (!parsed.success) {
			return {
				branch: "email",
				email: String(form.get("email") ?? ""),
				error: "Enter a valid email address.",
			} satisfies ActionResult;
		}
		const [existing] = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.email, email))
			.limit(1);
		return {
			branch: existing ? "login" : "signup",
			email,
		} satisfies ActionResult;
	}

	// Both authentication intents are bot-verified through the Turnstile port —
	// without configured keys the port resolves to a pass, so headless judges
	// and local dev are never blocked.
	if (intent === "login" || intent === "signup") {
		const token = String(form.get("cf-turnstile-response") ?? "");
		const human = await getTurnstile(env).verify(
			token,
			request.headers.get("CF-Connecting-IP") ?? undefined,
		);
		if (!human) {
			track("cfp.turnstile_rejected", { intent });
			return data(
				{
					branch: intent,
					email,
					error:
						"We couldn't verify that you're human. Please retry the security check.",
				} satisfies ActionResult,
				{ status: 400 },
			);
		}
	}

	if (intent === "login") {
		const password = String(form.get("password") ?? "");
		const [user] = await db
			.select()
			.from(users)
			.where(eq(users.email, email))
			.limit(1);
		const ok = await verifyPasswordTimingEqual(password, user?.passwordHash);
		if (!user || !ok) {
			return data(
				{
					branch: "login",
					email,
					error: "Incorrect email or password.",
				} satisfies ActionResult,
				{ status: 400 },
			);
		}
		await linkUserToContacts(db, bundle.event.id, user.id, user.email);
		track("cfp.login", { formId: bundle.form.id });
		const cookie = await createSession(env, user.id, isSecureRequest(request));
		return redirect(stepPath(base, "session"), {
			headers: { "Set-Cookie": cookie },
		});
	}

	if (intent === "signup") {
		const parsed = Signup.safeParse({
			email,
			firstName: form.get("firstName"),
			lastName: form.get("lastName"),
			password: form.get("password"),
			terms: form.get("terms"),
		});
		if (!parsed.success) {
			const flat = z.flattenError(parsed.error).fieldErrors;
			const fieldErrors: Record<string, string> = {};
			for (const [key, messages] of Object.entries(flat)) {
				if (messages?.[0]) fieldErrors[key] = messages[0];
			}
			return data(
				{ branch: "signup", email, fieldErrors } satisfies ActionResult,
				{ status: 400 },
			);
		}
		const [existing] = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.email, email))
			.limit(1);
		if (existing) {
			return {
				branch: "login",
				email,
				error: "You already have an account — log in with your password.",
			} satisfies ActionResult;
		}
		const timings = createTimings();
		let userId: string;
		try {
			userId = await timings.time("db", async () => {
				const passwordHash = await hashPassword(parsed.data.password);
				const newUserId = crypto.randomUUID();
				// Claim the roster contact carrying this email (the organizer may
				// have added the speaker before they ever signed up), else mint one —
				// atomically with the user row, so a failure strands neither half.
				const [claimable] = await db
					.select({ id: contacts.id })
					.from(contacts)
					.where(
						and(
							eq(contacts.eventId, bundle.event.id),
							eq(contacts.email, email),
							isNull(contacts.userId),
						),
					)
					.limit(1);
				await db.batch([
					db.insert(users).values({
						id: newUserId,
						email,
						passwordHash,
						name: `${parsed.data.firstName} ${parsed.data.lastName}`,
						role: "speaker",
					}),
					claimable
						? db
								.update(contacts)
								.set({ userId: newUserId })
								.where(eq(contacts.id, claimable.id))
						: db.insert(contacts).values({
								eventId: bundle.event.id,
								userId: newUserId,
								email,
								firstName: parsed.data.firstName,
								lastName: parsed.data.lastName,
							}),
				]);
				return newUserId;
			});
		} catch (error) {
			track("cfp.signup_failed", { error: errorMessage(error) });
			return data(
				{
					branch: "signup",
					email,
					error: "We couldn't create your account — please try again.",
				} satisfies ActionResult,
				{ status: 500 },
			);
		}
		track("cfp.signup", { formId: bundle.form.id });
		const cookie = await createSession(env, userId, isSecureRequest(request));
		return redirect(stepPath(base, "session"), {
			headers: { "Set-Cookie": cookie, "Server-Timing": timings.header() },
		});
	}

	throw data({ error: "Unknown intent" }, { status: 400 });
}

export default function AccountStep({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const layout = useRouteLoaderData<LayoutRoute.ComponentProps["loaderData"]>(
		"routes/submit.$eventSlug.$formId",
	);
	if (!layout) return null;
	const base = submitBasePath(layout.event.slug, layout.form.publicId);
	const result = actionData as ActionResult | undefined;
	const branch = result?.branch ?? "email";

	if (layout.user) {
		return (
			<Panel>
				<div className="flex flex-col gap-4">
					<PageTitle>You’re signed in</PageTitle>
					<MutedText>
						Continue as {layout.user.name ?? layout.user.email} (
						{layout.user.email}), or use the log out link below to switch
						accounts.
					</MutedText>
					<div className="flex flex-wrap gap-3">
						<ButtonLink to={stepPath(base, "session")}>
							Continue to submission
						</ButtonLink>
						<ButtonLink to={base} variant="ghost">
							Back
						</ButtonLink>
					</div>
				</div>
			</Panel>
		);
	}

	return (
		<Panel>
			<Form method="post" className="flex flex-col gap-4">
				<PageTitle>
					{branch === "signup"
						? "Create your speaker account"
						: branch === "login"
							? "Log in with your existing account"
							: "Let's find your account"}
				</PageTitle>
				{branch === "email" && (
					<MutedText>
						Enter your email address — we’ll sign you in, or create your speaker
						account if you’re new.
					</MutedText>
				)}
				<Field label="Your Email Address *" error={result?.fieldErrors?.email}>
					<Input
						name="email"
						type="email"
						autoComplete="username"
						required
						defaultValue={result?.email}
						placeholder="you@example.com"
					/>
				</Field>

				{branch === "login" && (
					<>
						<div className="flex flex-col gap-1">
							<Field
								label="Enter your existing password *"
								error={result?.error}
							>
								<Input
									name="password"
									type="password"
									autoComplete="current-password"
									required
								/>
							</Field>
							<div className="self-end">
								<TextLink to="/forgot-password">Forgot your password?</TextLink>
							</div>
						</div>
						<TurnstileWidget siteKey={loaderData.turnstileSiteKey} />
						<div className="flex flex-wrap items-center gap-3">
							<Button type="submit" name="intent" value="login">
								Log In →
							</Button>
							<ButtonLink to={base} variant="ghost">
								Back
							</ButtonLink>
						</div>
					</>
				)}

				{branch === "signup" && (
					<>
						<div className="grid gap-4 sm:grid-cols-2">
							<Field
								label="First Name *"
								error={result?.fieldErrors?.firstName}
							>
								<Input name="firstName" autoComplete="given-name" required />
							</Field>
							<Field label="Last Name *" error={result?.fieldErrors?.lastName}>
								<Input name="lastName" autoComplete="family-name" required />
							</Field>
						</div>
						<div className="flex flex-col gap-1">
							<Field
								label="Create a password *"
								error={result?.fieldErrors?.password}
							>
								<Input
									name="password"
									type="password"
									autoComplete="new-password"
									required
									minLength={8}
								/>
							</Field>
							<MutedText>
								At least 8 characters, with a capital letter, a number, and a
								special character.
							</MutedText>
						</div>
						<div className="flex flex-col gap-1">
							<Checkbox
								name="terms"
								label="I agree that my submission and contact details will be stored and shared with the event organizers."
							/>
							{result?.fieldErrors?.terms && (
								<ErrorText>{result.fieldErrors.terms}</ErrorText>
							)}
						</div>
						{result?.error && <ErrorText>{result.error}</ErrorText>}
						<TurnstileWidget siteKey={loaderData.turnstileSiteKey} />
						<div className="flex flex-wrap items-center gap-3">
							<Button type="submit" name="intent" value="signup">
								Create account
							</Button>
							<ButtonLink to={base} variant="ghost">
								Back
							</ButtonLink>
						</div>
					</>
				)}

				{branch === "email" && (
					<>
						{result?.error && <ErrorText>{result.error}</ErrorText>}
						<div className="flex flex-wrap items-center gap-3">
							<Button type="submit" name="intent" value="lookup">
								Next →
							</Button>
							<ButtonLink to={base} variant="ghost">
								Back
							</ButtonLink>
						</div>
					</>
				)}
			</Form>
		</Panel>
	);
}
