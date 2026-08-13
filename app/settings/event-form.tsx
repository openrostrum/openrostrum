import { useState } from "react";
import { TimezoneSelect } from "~/components/timezone-select";
import type { fields } from "~/db/schema";
import { Field, Input, Select } from "~/ui";

/**
 * The one event-details form, shared by /admin/settings (edit) and
 * /admin/events/new (create) so the two can never drift apart. CLIENT-SAFE — no
 * drizzle/schema value imports (they would drag the ORM into the client
 * bundle); validation lives in event-details.server.ts.
 */

export const EVENT_TYPES = [
	"Conference",
	"Summit",
	"Meetup",
	"Workshop",
	"Webinar",
	"Hackathon",
	"Other",
] as const;

export type EventDetailsValues = Record<
	| "name"
	| "slug"
	| "type"
	| "websiteUrl"
	| "location"
	| "timezone"
	| "theme"
	| "startsAt"
	| "endsAt"
	| "submissionLimit",
	string
>;

export type EventDetailsErrors = Partial<
	Record<keyof EventDetailsValues, string[]>
>;

// Compile-time pin against the schema enum (type-only import keeps drizzle out
// of the client bundle); the server action re-validates against the real enum.
export const FIELD_TYPES = [
	"text",
	"textarea",
	"wysiwyg",
	"dropdown",
	"checkbox",
	"number",
	"email",
	"phone",
	"date",
	"section_header",
	"divider",
] as const satisfies readonly (typeof fields.$inferSelect)["type"][];

// Keyed off the SCHEMA union, not the local array — a new FIELD_TYPE value
// fails compilation here until it gets a label and a dropdown entry.
export const FIELD_TYPE_LABELS: Record<
	(typeof fields.$inferSelect)["type"],
	string
> = {
	text: "Text",
	textarea: "Text area",
	wysiwyg: "Rich text",
	dropdown: "Dropdown",
	checkbox: "Checkbox",
	number: "Number",
	email: "Email",
	phone: "Phone",
	date: "Date",
	section_header: "Section header",
	divider: "Divider",
};

/** Branding-image upload contract, shown in the UI and enforced server-side. */
export const EVENT_IMAGE = {
	logo: {
		label: "Logo",
		hint: "Recommended 300×300",
		maxBytes: 2 * 1024 * 1024,
	},
	background: {
		label: "Background",
		hint: "Recommended 1500×500 — use an image with no words",
		maxBytes: 2 * 1024 * 1024,
	},
} as const;

export type EventImageKind = keyof typeof EVENT_IMAGE;

export const EVENT_IMAGE_TYPES: readonly string[] = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
];

export const EVENT_IMAGE_ACCEPT = EVENT_IMAGE_TYPES.join(",");

export function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function eventSlugBase(name: string): string {
	return slugify(name) || "event";
}

export function EventDetailsFields({
	values,
	errors,
	autoSlug = false,
}: {
	values: EventDetailsValues | null;
	errors?: EventDetailsErrors;
	autoSlug?: boolean;
}) {
	const [slug, setSlug] = useState(values?.slug ?? "");
	const [slugEdited, setSlugEdited] = useState(false);

	const typeOptions: string[] = [...EVENT_TYPES];
	if (values?.type && !typeOptions.includes(values.type)) {
		typeOptions.unshift(values.type);
	}

	const err = (key: keyof EventDetailsValues) => errors?.[key]?.[0];

	return (
		<div className="flex flex-col gap-[13px]">
			<div className="flex flex-wrap gap-3 [&>label]:min-w-[220px] [&>label]:flex-1">
				<Field label="Event name" error={err("name")}>
					<Input
						name="name"
						required
						placeholder="Devcon 2027"
						defaultValue={values?.name}
						invalid={Boolean(err("name"))}
						onChange={
							autoSlug
								? (e) => {
										if (!slugEdited) setSlug(eventSlugBase(e.target.value));
									}
								: undefined
						}
					/>
				</Field>
				<Field label="URL slug" error={err("slug")}>
					{autoSlug ? (
						<Input
							name="slug"
							required
							placeholder="devcon-2027"
							value={slug}
							invalid={Boolean(err("slug"))}
							onChange={(e) => {
								setSlug(e.target.value);
								setSlugEdited(true);
							}}
						/>
					) : (
						<Input
							name="slug"
							required
							placeholder="devcon-2027"
							defaultValue={values?.slug}
							invalid={Boolean(err("slug"))}
						/>
					)}
				</Field>
			</div>
			<div className="flex flex-wrap gap-3 [&>label]:min-w-[220px] [&>label]:flex-1">
				<Field label="Event type" error={err("type")}>
					<Select name="type" defaultValue={values?.type ?? "Conference"}>
						{typeOptions.map((t) => (
							<option key={t} value={t}>
								{t}
							</option>
						))}
					</Select>
				</Field>
				<Field label="Website URL" error={err("websiteUrl")}>
					<Input
						name="websiteUrl"
						type="url"
						placeholder="https://devcon.example.com"
						defaultValue={values?.websiteUrl}
						invalid={Boolean(err("websiteUrl"))}
					/>
				</Field>
			</div>
			<div className="flex flex-wrap gap-3 [&>label]:min-w-[220px] [&>label]:flex-1">
				<Field label="Location" error={err("location")}>
					<Input
						name="location"
						placeholder="Lyon, France"
						defaultValue={values?.location}
						invalid={Boolean(err("location"))}
					/>
				</Field>
				<TimezoneSelect
					value={values?.timezone ?? null}
					error={err("timezone")}
				/>
			</div>
			<div className="flex flex-wrap gap-3 [&>label]:min-w-[220px] [&>label]:flex-1">
				<Field label="Starts at" error={err("startsAt")}>
					<Input
						name="startsAt"
						type="datetime-local"
						required
						defaultValue={values?.startsAt}
						invalid={Boolean(err("startsAt"))}
					/>
				</Field>
				<Field label="Ends at" error={err("endsAt")}>
					<Input
						name="endsAt"
						type="datetime-local"
						required
						defaultValue={values?.endsAt}
						invalid={Boolean(err("endsAt"))}
					/>
				</Field>
			</div>
			<div className="flex flex-wrap gap-3 [&>label]:min-w-[220px] [&>label]:flex-1">
				<Field label="Submission limit" error={err("submissionLimit")}>
					<Input
						name="submissionLimit"
						type="number"
						min={1}
						step={1}
						placeholder="No limit"
						defaultValue={values?.submissionLimit}
						invalid={Boolean(err("submissionLimit"))}
					/>
				</Field>
				<Field label="Theme" error={err("theme")}>
					<Input
						name="theme"
						maxLength={1000}
						placeholder="A short description of the event's focus and audience"
						defaultValue={values?.theme}
						invalid={Boolean(err("theme"))}
					/>
				</Field>
			</div>
		</div>
	);
}
