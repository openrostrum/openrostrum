import { Form } from "react-router";
import type { loader } from "~/routes/portals.$eventSlug.$portalId.submissions_.$submissionId";
import {
	Avatar,
	Button,
	Chip,
	ErrorText,
	Field,
	Input,
	PageHeader,
	Select,
	StatusBadge,
	TextLink,
} from "~/ui";
import { CheckboxGroup } from "../checkbox-group";
import { ConfirmButton } from "../confirm-button";
import { RichHtml } from "../rich-html";
import { RichTextEditor } from "../rich-text";
import { Card, MetaGrid, Muted, Notice, Row, RowList, Strong } from "./bits";
import { ParticipationControls } from "./participation-controls";

export type SubmissionDetailData = Awaited<ReturnType<typeof loader>>["data"];

export type SubmissionDetailActionData = {
	fieldErrors?: Record<string, string[] | undefined>;
	formError?: string;
	intent?: string;
};

const ROLE_LABEL: Record<string, string> = {
	speaker: "Speaker",
	chairperson: "Chairperson",
	moderator: "Moderator",
	secondary: "Secondary contact",
};

export function SubmissionDetailView({
	data,
	actionData,
}: {
	data: SubmissionDetailData;
	actionData?: SubmissionDetailActionData;
}) {
	const {
		base,
		title,
		status,
		descriptionHtml,
		meta,
		schedule,
		room,
		participants,
		myParticipation,
		editWindow,
		canWithdrawSubmission,
		isWithdrawn,
		withdrawnReason,
		isDraft,
		saved,
		edit,
	} = data;
	const errs = actionData?.fieldErrors ?? {};
	const err = (key: string) => errs[key]?.[0];

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-2">
				<TextLink to={`${base}/submissions`}>← All submissions</TextLink>
				<PageHeader
					title={title}
					actions={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
				/>
			</div>

			{saved === "content" && (
				<Notice tone="success">Your changes were saved.</Notice>
			)}
			{saved === "participant" && (
				<Notice tone="success">Participant added.</Notice>
			)}
			{saved === "removed" && (
				<Notice tone="success">Participant removed.</Notice>
			)}
			{isWithdrawn && (
				<Notice tone="info">
					This submission was withdrawn
					{withdrawnReason ? ` — “${withdrawnReason}”` : ""}.
				</Notice>
			)}
			{isDraft && (
				<Notice tone="info">
					This is a draft — it has not been submitted to the organizers yet.
				</Notice>
			)}

			<Card title="Session details">
				<div className="flex flex-col gap-4">
					<MetaGrid
						items={[
							{ label: "Format", value: meta.format ?? "—" },
							{ label: "Level", value: meta.level ?? "—" },
							{ label: "Language", value: meta.language },
							schedule ? { label: "Scheduled", value: schedule } : null,
							room ? { label: "Room", value: room } : null,
							meta.tracks.length > 0
								? {
										label: "Tracks",
										value: (
											<span className="flex flex-wrap gap-3">
												{meta.tracks.map((t) => (
													<Chip key={t.name} color={t.color}>
														{t.name}
													</Chip>
												))}
											</span>
										),
									}
								: null,
							meta.tags.length > 0
								? {
										label: "Tags",
										value: (
											<span className="flex flex-wrap gap-3">
												{meta.tags.map((t) => (
													<Chip key={t.name} color={t.color}>
														{t.name}
													</Chip>
												))}
											</span>
										),
									}
								: null,
						]}
					/>
					{!editWindow.editable && descriptionHtml && (
						<RichHtml html={descriptionHtml} />
					)}
				</div>
			</Card>

			{myParticipation?.confirmable && (
				<Card title="Your participation">
					<ParticipationControls
						action={`${base}/submissions/${data.id}`}
						participation={myParticipation}
					/>
				</Card>
			)}

			<Card title="Participants">
				<RowList>
					{participants.map((p) => (
						<Row
							key={p.id}
							right={
								<>
									{p.acceptance && (
										<StatusBadge tone={p.acceptance.tone}>
											{p.acceptance.label}
										</StatusBadge>
									)}
									{editWindow.editable && p.removable && (
										<Form method="post">
											<input type="hidden" name="participantId" value={p.id} />
											<ConfirmButton
												label="Remove"
												prompt={`Remove ${p.name} from this submission?`}
												confirmLabel="Yes, remove"
												name="intent"
												value="remove-participant"
											/>
										</Form>
									)}
								</>
							}
						>
							<span className="flex items-center gap-2">
								<Avatar name={p.name} size={24} />
								<Strong>
									{p.name}
									{p.isMe ? " (you)" : ""}
								</Strong>
								<Muted>{ROLE_LABEL[p.role] ?? p.role}</Muted>
							</span>
						</Row>
					))}
				</RowList>
				{actionData?.intent === "remove-participant" &&
					actionData.formError && <ErrorText>{actionData.formError}</ErrorText>}

				{editWindow.editable && (
					<Form method="post" className="mt-4 flex flex-wrap items-end gap-3">
						<Field label="First name" error={err("firstName")}>
							<Input name="firstName" invalid={Boolean(err("firstName"))} />
						</Field>
						<Field label="Last name" error={err("lastName")}>
							<Input name="lastName" invalid={Boolean(err("lastName"))} />
						</Field>
						<Field label="Email" error={err("email")}>
							<Input
								name="email"
								type="email"
								invalid={Boolean(err("email"))}
							/>
						</Field>
						<Field label="Role">
							<Select name="role" defaultValue="speaker">
								<option value="speaker">Speaker</option>
								<option value="secondary">Secondary contact</option>
							</Select>
						</Field>
						<Button
							type="submit"
							name="intent"
							value="add-participant"
							icon="plus"
						>
							Add participant
						</Button>
						{actionData?.intent === "add-participant" &&
							actionData.formError && (
								<ErrorText>{actionData.formError}</ErrorText>
							)}
					</Form>
				)}
			</Card>

			{editWindow.editable && edit ? (
				<Card title="Edit submission">
					<div className="flex flex-col gap-4">
						{editWindow.closesLabel && (
							<Notice tone="info">
								You can edit this submission until the form closes on{" "}
								{editWindow.closesLabel}.
							</Notice>
						)}
						<Form method="post" className="flex flex-col gap-4">
							<Field label="Title *" error={err("title")}>
								<Input
									name="title"
									defaultValue={title}
									maxLength={255}
									invalid={Boolean(err("title"))}
								/>
							</Field>
							<RichTextEditor
								name="description"
								label="Description"
								defaultValue={descriptionHtml}
								maxLength={5000}
								error={err("description")}
							/>
							<div className="flex flex-wrap gap-4">
								<Field label="Format">
									<Select name="formatId" defaultValue={edit.formatId ?? ""}>
										<option value="">—</option>
										{edit.options.formats.map((f) => (
											<option key={f.id} value={f.id}>
												{f.name}
											</option>
										))}
									</Select>
								</Field>
								<Field label="Level">
									<Select name="levelId" defaultValue={edit.levelId ?? ""}>
										<option value="">—</option>
										{edit.options.levels.map((l) => (
											<option key={l.id} value={l.id}>
												{l.name}
											</option>
										))}
									</Select>
								</Field>
								<Field label="Language">
									<Select name="language" defaultValue={edit.language}>
										{[
											edit.language,
											...edit.options.languages.filter(
												(l) => l !== edit.language,
											),
										].map((l) => (
											<option key={l} value={l}>
												{l}
											</option>
										))}
									</Select>
								</Field>
							</div>
							{edit.options.tracks.length > 0 && (
								<div className="flex flex-col gap-[5px]">
									<Muted>Tracks</Muted>
									<CheckboxGroup
										name="trackIds"
										options={edit.options.tracks.map((t) => ({
											value: t.id,
											label: t.name,
										}))}
										defaultChecked={edit.trackIds}
									/>
								</div>
							)}
							{edit.options.tags.length > 0 && (
								<div className="flex flex-col gap-[5px]">
									<Muted>Tags</Muted>
									<CheckboxGroup
										name="tagIds"
										options={edit.options.tags.map((t) => ({
											value: t.id,
											label: t.name,
										}))}
										defaultChecked={edit.tagIds}
									/>
								</div>
							)}
							<div className="flex items-center gap-3">
								<Button type="submit" name="intent" value="update">
									Save changes
								</Button>
								{actionData?.intent === "update" && actionData.formError && (
									<ErrorText>{actionData.formError}</ErrorText>
								)}
							</div>
						</Form>
					</div>
				</Card>
			) : (
				!editWindow.editable &&
				editWindow.reason && <Notice tone="info">{editWindow.reason}</Notice>
			)}

			{canWithdrawSubmission && (
				<Card title="Withdraw submission">
					<div className="flex flex-col gap-2">
						<Muted>
							Withdrawing tells the organizers this session should no longer be
							considered. This applies to the whole submission — to step back
							personally, use your participation controls above.
						</Muted>
						<Form method="post" className="flex flex-wrap items-center gap-2">
							<ConfirmButton
								label="Withdraw submission"
								prompt="Withdraw this submission for everyone on it?"
								confirmLabel="Yes, withdraw it"
								name="intent"
								value="withdraw-submission"
							>
								<Input
									name="reason"
									placeholder="Reason (optional)"
									maxLength={500}
								/>
							</ConfirmButton>
							{actionData?.intent === "withdraw-submission" &&
								actionData.formError && (
									<ErrorText>{actionData.formError}</ErrorText>
								)}
						</Form>
					</div>
				</Card>
			)}
		</div>
	);
}
