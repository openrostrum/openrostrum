// @public — reached from email footers by logged-out recipients; the signed
// token in the URL is the authorization.
import { eq } from "drizzle-orm";
import { Form } from "react-router";
import { getDb } from "~/db";
import { emailSuppressions } from "~/db/schema";
import { verifyUnsubscribeToken } from "~/lib/unsubscribe";
import { useBusy } from "~/lib/use-busy";
import { track } from "~/lib/track";
import { Button, PageHeader, Panel, Wordmark } from "~/ui";
import type { Route } from "./+types/unsubscribe.$token";

export async function loader({ context, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const email = await verifyUnsubscribeToken(env, params.token);
	if (!email) return { state: "invalid" as const, email: null };
	const db = getDb(env);
	const [existing] = await db
		.select({ id: emailSuppressions.id })
		.from(emailSuppressions)
		.where(eq(emailSuppressions.email, email))
		.limit(1);
	return { state: existing ? ("done" as const) : ("confirm" as const), email };
}

export async function action({ context, params }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	// Re-verify in the action — never trust that the loader ran first.
	const email = await verifyUnsubscribeToken(env, params.token);
	if (!email) return { state: "invalid" as const, email: null };
	const db = getDb(env);
	// Idempotent: a second confirm (double-click, re-visit) is a no-op, not an
	// error — suppression is keyed on the address alone (person-global).
	await db
		.insert(emailSuppressions)
		.values({ email, reason: "unsubscribe_link" })
		.onConflictDoNothing({ target: emailSuppressions.email });
	// No address in the log — the suppression row itself is the record.
	track("email.unsubscribed");
	return { state: "done" as const, email };
}

const STILL_DELIVERS =
	"You'll still receive emails about your own submissions — acceptance decisions, reminders, password resets, and schedule updates always deliver.";

export default function Unsubscribe({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const busy = useBusy();
	const state = actionData?.state ?? loaderData.state;
	const email = actionData?.email ?? loaderData.email;

	return (
		<main className="mx-auto flex min-h-screen max-w-[420px] flex-col justify-center gap-7 px-6 py-16">
			<div className="flex justify-center">
				<Wordmark size={21} />
			</div>
			{state === "invalid" && (
				<PageHeader
					title="This link isn't valid"
					tone="danger"
					subtitle="The unsubscribe link is incomplete or has been altered. Copy the full link from the email footer and try again."
				/>
			)}
			{state === "done" && (
				<PageHeader
					title="You're unsubscribed"
					subtitle={`${email} won't receive announcement emails from event organizers. ${STILL_DELIVERS}`}
				/>
			)}
			{state === "confirm" && (
				<div className="flex flex-col gap-5">
					<PageHeader
						title="Unsubscribe from announcements"
						subtitle={`Stop announcement emails to ${email}. ${STILL_DELIVERS}`}
					/>
					<Panel>
						<Form method="post" className="flex">
							<Button type="submit" disabled={busy}>
								Unsubscribe {email}
							</Button>
						</Form>
					</Panel>
				</div>
			)}
		</main>
	);
}

export function ErrorBoundary() {
	return (
		<main className="mx-auto flex min-h-screen max-w-[420px] flex-col justify-center px-6 py-16">
			<PageHeader
				title="Something went wrong"
				tone="danger"
				subtitle="Please re-open the unsubscribe link from your email and try again."
			/>
		</main>
	);
}
