import { eq } from "drizzle-orm";
import { Form, redirect } from "react-router";
import { z } from "zod";
import {
	FALLBACK_TIMEZONE,
	TimezoneSelect,
} from "~/components/timezone-select";
import { getDb } from "~/db";
import { events } from "~/db/schema";
import { requireOnboardingEvent } from "~/domain/onboarding";
import { requireAdmin } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import { createTimings, track } from "~/lib/track";
import { useBusy } from "~/lib/use-busy";
import {
	dateToZonedInput,
	isValidTimeZone,
	zonedInputToDate,
} from "~/settings/event-details.server";
import { Button, ErrorText, Field, Input, PageHeader, Panel } from "~/ui";
import type { Route } from "./+types/onboarding.dates";

/**
 * Step 2: the two dates that unlock the countdown, deadline maths, and every
 * public page. Skippable on purpose — plenty of organizers open the tool
 * before the venue is confirmed, and a wall here would cost them the account.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DatesForm = z
	.object({
		startsAt: z.string().regex(DATE_RE, "Pick a start date"),
		endsAt: z.string().regex(DATE_RE, "Pick an end date"),
	})
	// Same "YYYY-MM-DD" shape on both sides, so string order = date order.
	.refine((v) => v.endsAt >= v.startsAt, {
		path: ["endsAt"],
		message: "The end must be on or after the start",
	});

type EchoValues = Record<"startsAt" | "endsAt" | "timezone", string>;

type ActionResult = {
	fieldErrors?: Partial<Record<keyof EchoValues, string[]>>;
	formError?: string;
	values?: EchoValues;
};

export async function loader({ context, request }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await requireOnboardingEvent(env, user);
	return {
		eventName: event.name,
		startsAt: event.startsAt
			? dateToZonedInput(event.startsAt, event.timezone).slice(0, 10)
			: "",
		endsAt: event.endsAt
			? dateToZonedInput(event.endsAt, event.timezone).slice(0, 10)
			: "",
		// A brand-new event carries the column default, which nobody chose —
		// null lets the picker offer the organizer's own zone instead.
		timezone: event.timezone === FALLBACK_TIMEZONE ? null : event.timezone,
	};
}

export async function action({
	context,
	request,
}: Route.ActionArgs): Promise<ActionResult | Response> {
	const env = context.cloudflare.env;
	const user = await requireAdmin(env, request);
	const event = await requireOnboardingEvent(env, user);

	const form = await request.formData();
	const values: EchoValues = {
		startsAt: String(form.get("startsAt") ?? ""),
		endsAt: String(form.get("endsAt") ?? ""),
		timezone: String(form.get("timezone") ?? ""),
	};
	// The zone is a browser signal we preselected, not an answer we demanded —
	// it is worth keeping even when the organizer skips the dates.
	const timezone = isValidTimeZone(values.timezone)
		? values.timezone
		: event.timezone;
	const skipped =
		form.get("intent") === "skip" ||
		(values.startsAt === "" && values.endsAt === "");

	const parsed = skipped ? null : DatesForm.safeParse(values);
	if (parsed && !parsed.success) {
		return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
	}

	// Date-only picks preserve the selected calendar day in the event zone:
	// starts open at local midnight and ends close at local 23:59.
	const dates =
		parsed?.success === true
			? {
					startsAt: zonedInputToDate(`${parsed.data.startsAt}T00:00`, timezone),
					endsAt: zonedInputToDate(`${parsed.data.endsAt}T23:59`, timezone),
				}
			: {};

	const timings = createTimings();
	try {
		await timings.time("db", () =>
			getDb(env)
				.update(events)
				.set({ timezone, ...dates })
				.where(eq(events.id, event.id)),
		);
	} catch (error) {
		track("onboarding.step_failed", {
			step: "dates",
			userId: user.id,
			error: errorMessage(error),
		});
		return {
			formError: "Could not save the dates — please try again.",
			values,
		};
	}

	track(skipped ? "onboarding.dates_skipped" : "onboarding.dates_saved", {
		eventId: event.id,
		userId: user.id,
	});
	return redirect("/onboarding/place", {
		headers: { "Server-Timing": timings.header() },
	});
}

export default function OnboardingDates({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const busy = useBusy();
	const values = actionData?.values;

	return (
		<>
			<PageHeader
				title={`When is ${loaderData.eventName}?`}
				subtitle="Dates drive your countdown, your submission deadlines, and every public page. Skip if nothing is booked yet — Settings can change all of it later."
			/>
			<Panel>
				<Form method="post" className="flex flex-col gap-[13px]">
					<div className="flex flex-wrap gap-3 [&>label]:min-w-[180px] [&>label]:flex-1">
						<Field
							label="First day"
							error={actionData?.fieldErrors?.startsAt?.[0]}
						>
							<Input
								name="startsAt"
								type="date"
								defaultValue={values?.startsAt ?? loaderData.startsAt}
								invalid={Boolean(actionData?.fieldErrors?.startsAt?.[0])}
							/>
						</Field>
						<Field
							label="Last day"
							error={actionData?.fieldErrors?.endsAt?.[0]}
						>
							<Input
								name="endsAt"
								type="date"
								defaultValue={values?.endsAt ?? loaderData.endsAt}
								invalid={Boolean(actionData?.fieldErrors?.endsAt?.[0])}
							/>
						</Field>
					</div>
					<TimezoneSelect
						value={values?.timezone ?? loaderData.timezone}
						error={actionData?.fieldErrors?.timezone?.[0]}
					/>
					<div className="flex flex-wrap items-center gap-3">
						<Button type="submit" disabled={busy}>
							Continue
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
