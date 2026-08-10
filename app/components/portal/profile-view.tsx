import { Form } from "react-router";
import { HEADSHOT_ACCEPT, HEADSHOT_CONSTRAINTS } from "~/lib/headshot";
import type { loader } from "~/routes/portals.$eventSlug.$portalId.profile";
import {
	Avatar,
	Button,
	EmptyState,
	ErrorText,
	Field,
	Input,
	Select,
} from "~/ui";
import { FilePicker } from "../file-picker";
import { RichTextEditor } from "../rich-text";
import { Card, Muted, Notice } from "./bits";

export type ProfileViewData = Awaited<ReturnType<typeof loader>>["data"];

export type ProfileActionData = {
	intent?: string;
	fieldErrors?: Record<string, string[] | undefined>;
	formError?: string;
};

const PRONOUNS = ["She/Her", "He/Him", "They/Them", "Prefer not to say"];
const GENDERS = ["Woman", "Man", "Non-binary", "Prefer not to say"];

function withCurrent(options: string[], current: string | null): string[] {
	return current && !options.includes(current)
		? [current, ...options]
		: options;
}

export function ProfileView({
	data,
	actionData,
}: {
	data: ProfileViewData;
	actionData?: ProfileActionData;
}) {
	const { contact, headshotUrl, saved } = data;
	const errs = actionData?.fieldErrors ?? {};
	const err = (key: string) => errs[key]?.[0];

	if (!contact) {
		return (
			<EmptyState
				icon="sliders"
				title="No speaker profile yet"
				body="Your profile is created when you join a submission — submit to the call for papers, or ask the event team to add you to a session."
			/>
		);
	}

	return (
		<div className="flex flex-col gap-5">
			{saved === "profile" && (
				<Notice tone="success">Your profile was saved.</Notice>
			)}
			{saved === "headshot" && (
				<Notice tone="success">Your headshot was updated.</Notice>
			)}

			<Card title="Headshot">
				<div className="flex flex-wrap items-start gap-5">
					{headshotUrl ? (
						<img
							src={headshotUrl}
							alt={`${contact.firstName} ${contact.lastName}`}
							className="h-24 w-24 rounded-card object-cover"
						/>
					) : (
						<Avatar
							name={`${contact.firstName} ${contact.lastName}`}
							size={96}
						/>
					)}
					<Form
						method="post"
						encType="multipart/form-data"
						className="flex min-w-0 flex-1 flex-col gap-3"
					>
						<input type="hidden" name="intent" value="headshot" />
						<FilePicker
							name="headshot"
							accept={HEADSHOT_ACCEPT}
							constraints={HEADSHOT_CONSTRAINTS}
							required
						/>
						<div className="flex items-center gap-3">
							<Button type="submit" variant="ghost" icon="export">
								Upload headshot
							</Button>
							{err("headshot") && <ErrorText>{err("headshot")}</ErrorText>}
						</div>
					</Form>
				</div>
			</Card>

			<Form method="post" className="flex flex-col gap-5">
				<input type="hidden" name="intent" value="profile" />
				<Card title="General">
					<div className="flex flex-col gap-4">
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<Field label="First name *" error={err("firstName")}>
								<Input
									name="firstName"
									defaultValue={contact.firstName}
									invalid={Boolean(err("firstName"))}
								/>
							</Field>
							<Field label="Last name *" error={err("lastName")}>
								<Input
									name="lastName"
									defaultValue={contact.lastName}
									invalid={Boolean(err("lastName"))}
								/>
							</Field>
							<Field label="Salutation" error={err("salutation")}>
								<Input
									name="salutation"
									defaultValue={contact.salutation ?? ""}
									placeholder="Dr., Prof., …"
								/>
							</Field>
							<Field label="Honorific" error={err("honorific")}>
								<Input
									name="honorific"
									defaultValue={contact.honorific ?? ""}
								/>
							</Field>
							<Field label="Pronouns">
								<Select name="pronouns" defaultValue={contact.pronouns ?? ""}>
									<option value="">—</option>
									{withCurrent(PRONOUNS, contact.pronouns).map((p) => (
										<option key={p} value={p}>
											{p}
										</option>
									))}
								</Select>
							</Field>
							<Field label="Gender">
								<Select name="gender" defaultValue={contact.gender ?? ""}>
									<option value="">—</option>
									{withCurrent(GENDERS, contact.gender).map((g) => (
										<option key={g} value={g}>
											{g}
										</option>
									))}
								</Select>
							</Field>
							<Field label="Job title" error={err("jobTitle")}>
								<Input name="jobTitle" defaultValue={contact.jobTitle ?? ""} />
							</Field>
							<Field label="Company name" error={err("companyName")}>
								<Input
									name="companyName"
									defaultValue={contact.companyName ?? ""}
								/>
							</Field>
							<Field label="Mobile phone" error={err("mobilePhone")}>
								<Input
									name="mobilePhone"
									type="tel"
									defaultValue={contact.mobilePhone ?? ""}
								/>
							</Field>
							<Field label="Home phone" error={err("homePhone")}>
								<Input
									name="homePhone"
									type="tel"
									defaultValue={contact.homePhone ?? ""}
								/>
							</Field>
						</div>
						<RichTextEditor
							name="bio"
							label="Biography"
							defaultValue={contact.bioHtml ?? ""}
							maxLength={5000}
							error={err("bio")}
						/>
						<div className="flex flex-col gap-1">
							<Muted>
								Signed in as {contact.email}. This is where the event team
								reaches you — contact them to change it.
							</Muted>
						</div>
					</div>
				</Card>

				<Card title="My Links">
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Field label="LinkedIn URL" error={err("linkedinUrl")}>
							<Input
								name="linkedinUrl"
								defaultValue={contact.linkedinUrl ?? ""}
								placeholder="https://www.linkedin.com/in/…"
								invalid={Boolean(err("linkedinUrl"))}
							/>
						</Field>
						<Field label="X (Twitter) URL" error={err("twitterUrl")}>
							<Input
								name="twitterUrl"
								defaultValue={contact.twitterUrl ?? ""}
								placeholder="@handle or https://x.com/…"
								invalid={Boolean(err("twitterUrl"))}
							/>
						</Field>
						<Field label="Facebook URL" error={err("facebookUrl")}>
							<Input
								name="facebookUrl"
								defaultValue={contact.facebookUrl ?? ""}
								invalid={Boolean(err("facebookUrl"))}
							/>
						</Field>
						<Field label="Website" error={err("websiteUrl")}>
							<Input
								name="websiteUrl"
								defaultValue={contact.websiteUrl ?? ""}
								placeholder="https://…"
								invalid={Boolean(err("websiteUrl"))}
							/>
						</Field>
					</div>
				</Card>

				<div className="flex items-center gap-3">
					<Button type="submit">Save profile</Button>
					{actionData?.intent === "profile" && actionData.formError && (
						<ErrorText>{actionData.formError}</ErrorText>
					)}
				</div>
			</Form>
		</div>
	);
}
