import { eq } from "drizzle-orm";
import { Form, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/db";
import { events } from "~/db/schema";
import { requireOnboardingEvent } from "~/domain/onboarding";
import { requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import { Button, ErrorText, Field, Input, PageHeader, Panel } from "~/ui";
import type { Route } from "./+types/onboarding.place";

/**
 * Step 3, and the last thing first run asks for: the location that sits beside
 * the dates on every public page. Finishing here lands on the dashboard with
 * "Confirm your event basics" already ticked — the checklist starts with
 * progress on it rather than five untouched rows.
 */

const PlaceForm = z.object({
	location: z
		.string()
		.trim()
		.max(200, "Keep the location under 200 characters")
		.transform((v) => (v === "" ? null : v)),
});

type EchoValues = Record<"location", string>;

type ActionResult = {
	fieldErrors?: Partial<Record<keyof EchoValues, string[]>>;
	formError?: string;
	values?: EchoValues;
};

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await requireOnboardingEvent(env, user);
	return { location: event.location ?? "" };
}

export async function action({
	context,
	request,
}: Route.ActionArgs): Promise<ActionResult | Response> {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await requireOnboardingEvent(env, user);

	const form = await request.formData();
	const values: EchoValues = { location: String(form.get("location") ?? "") };
	const skipped = form.get("intent") === "skip";
	const parsed = PlaceForm.safeParse(values);
	if (!skipped && !parsed.success) {
		return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
	}

	const timings = createTimings();
	// Skipping leaves the column untouched; submitting writes what is in the
	// box, including a deliberate blank.
	if (!skipped && parsed.success) {
		try {
			await timings.time("db", () =>
				getDb(env)
					.update(events)
					.set({ location: parsed.data.location })
					.where(eq(events.id, event.id)),
			);
		} catch (error) {
			track("onboarding.step_failed", {
				step: "place",
				userId: user.id,
				error: errorMessage(error),
			});
			return {
				formError: "Could not save the location — please try again.",
				values,
			};
		}
	}

	track("onboarding.completed", {
		organizationId: event.organizationId,
		eventId: event.id,
		userId: user.id,
	});
	return redirect("/admin", {
		headers: { "Server-Timing": timings.header() },
	});
}

export default function OnboardingPlace({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const busy = useBusy();
	const locationError = actionData?.fieldErrors?.location?.[0];

	return (
		<>
			<PageHeader
				title="Where is it?"
				subtitle="A city is enough for now — speakers and attendees see it on every public page. Next stop: your dashboard."
			/>
			<Panel>
				<Form method="post" className="flex flex-col gap-[13px]">
					<Field label="Location" error={locationError}>
						<Input
							name="location"
							maxLength={200}
							placeholder="Lyon, France"
							defaultValue={actionData?.values?.location ?? loaderData.location}
							invalid={Boolean(locationError)}
						/>
					</Field>
					<div className="flex flex-wrap items-center gap-3">
						<Button type="submit" disabled={busy}>
							Finish setup
						</Button>
						<Button
							type="submit"
							name="intent"
							value="skip"
							variant="ghost"
							disabled={busy}
						>
							Skip for now
						</Button>
					</div>
					{actionData?.formError && (
						<ErrorText>{actionData.formError}</ErrorText>
					)}
				</Form>
			</Panel>
		</>
	);
}
