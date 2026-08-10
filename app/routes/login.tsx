// @public — this route establishes auth; it must be reachable while logged out.
import { eq } from "drizzle-orm";
import { Form, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { users } from "~/db/schema";
import {
	createSession,
	getUser,
	homePathForRole,
	isSecureRequest,
	normalizeEmail,
	safeRedirect,
	verifyPassword,
} from "~/lib/auth";
import {
	Button,
	ErrorText,
	Field,
	Input,
	Panel,
	TextLink,
	Wordmark,
} from "~/ui";
import type { Route } from "./+types/login";

const Credentials = z.object({
	email: z.string().email(),
	password: z.string().min(1),
});

// A valid PBKDF2 hash used only to equalize login timing when the email doesn't
// exist, so the response time can't reveal whether an account exists.
const DUMMY_HASH =
	"pbkdf2$600000$nRz+NCgbip51gWKmrtbi5w==$aFZ0QBI/rzxCV3+hHj/erqG1ONnn4A2G4nQVWa5QGlM=";

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
	const ok = await verifyPassword(
		parsed.data.password,
		user?.passwordHash ?? DUMMY_HASH,
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
	return (
		<main className="mx-auto flex min-h-screen max-w-[360px] flex-col justify-center gap-7 px-6 py-16">
			<div className="flex justify-center">
				<Wordmark size={21} />
			</div>
			<Panel>
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
					<Button type="submit">Sign in</Button>
					{actionData?.error && <ErrorText>{actionData.error}</ErrorText>}
					<TextLink to="/forgot-password">Forgot your password?</TextLink>
				</Form>
			</Panel>
		</main>
	);
}
