// @public — this route establishes auth; it must be reachable while logged out.
import { eq } from "drizzle-orm";
import { Form, redirect } from "react-router";
import { z } from "zod";
import { AuthPage } from "~/marketing/auth";
import { getDb } from "~/db";
import { users } from "~/db/schema";
import {
	createSession,
	getUser,
	homePathForRole,
	isSecureRequest,
	normalizeEmail,
	safeRedirect,
	verifyPasswordTimingEqual,
} from "~/lib/auth";
import { useBusy } from "~/lib/use-busy";
import { Button, ErrorText, Field, Input, TextLink } from "~/ui";
import type { Route } from "./+types/login";

const Credentials = z.object({
	email: z.string().email(),
	password: z.string().min(1),
});

export function meta(_: Route.MetaArgs) {
	return [{ title: "Sign in — OpenRostrum" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
	if (await getUser(context.cloudflare.env, request)) throw redirect("/admin");
	return {};
}

export async function action({ context, request }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const form = await request.formData();
	const parsed = Credentials.safeParse({
		email: form.get("email"),
		password: form.get("password"),
	});
	if (!parsed.success) return { error: "Enter a valid email and password." };

	const db = getDb(env);
	const [user] = await db
		.select()
		.from(users)
		.where(eq(users.email, normalizeEmail(parsed.data.email)))
		.limit(1);
	// Always run the (expensive) verify — against a dummy hash when the email
	// doesn't exist — so timing can't reveal whether the account exists.
	const ok = await verifyPasswordTimingEqual(
		parsed.data.password,
		user?.passwordHash,
	);
	if (!user || !ok) {
		return { error: "Incorrect email or password." };
	}

	const requested = new URL(request.url).searchParams.get("redirectTo") ?? "";
	const dest = safeRedirect(requested) ?? homePathForRole(user.role);
	const cookie = await createSession(env, user.id, isSecureRequest(request));
	return redirect(dest, { headers: { "Set-Cookie": cookie } });
}

export default function Login({ actionData }: Route.ComponentProps) {
	const busy = useBusy();
	return (
		<AuthPage
			title="Sign in to OpenRostrum"
			nav={{
				prompt: "New to OpenRostrum?",
				label: "Create your account",
				to: "/signup",
			}}
			below={<TextLink to="/forgot-password">Forgot your password?</TextLink>}
		>
			<Form method="post" className="flex flex-col gap-[13px]">
				<Field label="Email">
					<Input
						name="email"
						type="email"
						autoComplete="username"
						required
						placeholder="you@conference.org"
					/>
				</Field>
				<Field label="Password">
					<Input
						name="password"
						type="password"
						autoComplete="current-password"
						required
					/>
				</Field>
				<Button type="submit" disabled={busy}>
					Sign in
				</Button>
				{actionData?.error && (
					<div role="alert">
						<ErrorText>{actionData.error}</ErrorText>
					</div>
				)}
			</Form>
		</AuthPage>
	);
}
