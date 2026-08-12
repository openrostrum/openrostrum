import { useState } from "react";
import { Form, useFetcher } from "react-router";
import { resolveCommentDraft } from "~/lib/comment-draft";
import { useBusy } from "~/lib/use-busy";
import type { loader } from "~/routes/portals.$eventSlug.$portalId.tasks_.$assignmentId";
import {
	Button,
	EmptyState,
	ErrorText,
	Input,
	PageHeader,
	StatusBadge,
	TextLink,
} from "~/ui";
import { FilePicker } from "../file-picker";
import { PortalFormFields } from "../portal-form-fields";
import { Card, MetaGrid, Muted, Notice, Strong } from "./bits";

type CommentView = {
	id: string;
	author: string;
	isYou: boolean;
	body: string;
	on: string;
};

export type TaskDetailData = Awaited<ReturnType<typeof loader>>["data"];

export type TaskDetailActionData = {
	intent?: string;
	ok?: boolean;
	commentKey?: string;
	commentFileId?: string;
	commentBody?: string;
	fieldErrors?: Record<string, string[] | undefined>;
	formError?: string;
};

function CommentThread({
	action,
	fileId,
	initialCommentKey,
	comments,
	actionData,
}: {
	action: string;
	fileId: string;
	initialCommentKey: string;
	comments: CommentView[];
	actionData: TaskDetailActionData | undefined;
}) {
	const fetcher = useFetcher<TaskDetailActionData>();
	const busy = useBusy();
	const posting = fetcher.state !== "idle";
	const [draft, setDraft] = useState({
		key: initialCommentKey,
		fileId,
		body: "",
	});
	const routeResult =
		actionData?.intent === "comment" && actionData.commentFileId === fileId
			? actionData
			: undefined;
	const result = fetcher.data ?? routeResult;
	const activeDraft = resolveCommentDraft(draft, result, fileId);
	return (
		<div className="mt-2 flex flex-col gap-2 border-l-2 border-hair pl-3">
			{comments.map((c) => (
				<div key={c.id} className="flex flex-col">
					<Muted>
						{c.author}
						{c.isYou ? " (you)" : ""} · {c.on}
					</Muted>
					<span className="text-[13px] text-fg">{c.body}</span>
				</div>
			))}
			{comments.length === 0 && (
				<EmptyState
					icon="mail"
					title="No comments yet"
					body="Write a comment below to start the thread with the event team."
				/>
			)}
			<fetcher.Form
				key={activeDraft.key}
				method="post"
				action={action}
				className="flex flex-wrap items-center gap-2"
			>
				<input type="hidden" name="intent" value="comment" />
				<input type="hidden" name="fileId" value={activeDraft.fileId} />
				<input type="hidden" name="commentKey" value={activeDraft.key} />
				<Input
					name="body"
					value={activeDraft.body}
					onChange={(event) =>
						setDraft({ ...activeDraft, body: event.currentTarget.value })
					}
					placeholder="Write a comment for the event team…"
					maxLength={2000}
					required
				/>
				<Button type="submit" variant="ghost" disabled={busy}>
					{posting ? "Posting…" : "Comment"}
				</Button>
				{result?.formError && <ErrorText>{result.formError}</ErrorText>}
			</fetcher.Form>
		</div>
	);
}

export function TaskDetailView({
	data,
	actionData,
}: {
	data: TaskDetailData;
	actionData?: TaskDetailActionData;
}) {
	const errs = actionData?.fieldErrors ?? {};
	const answerErrors = Object.fromEntries(
		Object.entries(errs)
			.filter(([, v]) => v?.length)
			.map(([k, v]) => [k, (v as string[])[0] ?? ""]),
	);
	const here = `${data.base}/tasks/${data.id}`;
	const busy = useBusy();

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-2">
				<TextLink to={`${data.base}/tasks`}>← All tasks</TextLink>
				<PageHeader
					title={data.name}
					actions={
						<StatusBadge tone={data.status.tone}>
							{data.status.label}
						</StatusBadge>
					}
				/>
			</div>

			{data.saved === "completed" && (
				<Notice tone="success">Task marked as complete.</Notice>
			)}
			{data.saved === "submitted" && (
				<Notice tone="success">
					Your form was submitted — the event team can see your answers.
				</Notice>
			)}
			{data.saved === "uploaded" && (
				<Notice tone="success">
					Your file was uploaded and is pending review by the event team.
				</Notice>
			)}

			<Card title="Task details">
				<div className="flex flex-col gap-3">
					<MetaGrid
						items={[
							{
								label: "Required",
								value: data.required ? "Yes" : "Optional",
							},
							data.due
								? {
										label: "Due",
										value: data.overdue ? (
											<Muted tone="danger">Overdue — was due {data.due}</Muted>
										) : (
											data.due
										),
									}
								: null,
							data.submissionTitle
								? {
										label: "For session",
										value: data.submissionId ? (
											<TextLink
												to={`${data.base}/submissions/${data.submissionId}`}
											>
												{data.submissionTitle}
											</TextLink>
										) : (
											data.submissionTitle
										),
									}
								: null,
							data.completedOn
								? { label: "Completed", value: data.completedOn }
								: null,
						]}
					/>
					{data.description && (
						<p className="text-[13px] text-fg-muted">{data.description}</p>
					)}
					{data.linkUrl && (
						<TextLink
							href={data.linkUrl}
							target="_blank"
							rel="noopener noreferrer"
						>
							Open link ↗
						</TextLink>
					)}
				</div>
			</Card>

			{data.kind === "simple" && (
				<Card title="Completion">
					<Form method="post" className="flex items-center gap-3">
						{data.isComplete ? (
							<>
								<Muted>Done — nice work.</Muted>
								<Button
									type="submit"
									name="intent"
									value="uncomplete"
									variant="ghost"
									disabled={busy}
								>
									Mark as incomplete
								</Button>
							</>
						) : (
							<Button
								type="submit"
								name="intent"
								value="complete"
								disabled={busy}
							>
								Mark as Complete
							</Button>
						)}
						{actionData?.intent !== "comment" && actionData?.formError && (
							<ErrorText>{actionData.formError}</ErrorText>
						)}
					</Form>
				</Card>
			)}

			{data.kind === "form" && data.form && (
				<Card title={data.form.title}>
					{data.form.submitted ? (
						<div className="flex flex-col gap-3">
							<Notice tone="info">
								Submitted — contact the event team if an answer needs to change.
							</Notice>
							<MetaGrid
								items={data.form.schema.map((f) => ({
									label: f.name,
									value: String(data.form?.answers[f.name] ?? "—") || "—",
								}))}
							/>
						</div>
					) : (
						<Form method="post" className="flex flex-col gap-4">
							<PortalFormFields
								schema={data.form.schema}
								errors={answerErrors}
							/>
							<div className="flex items-center gap-3">
								<Button
									type="submit"
									name="intent"
									value="submit-form"
									disabled={busy}
								>
									Submit
								</Button>
								{actionData?.intent === "submit-form" &&
									actionData.formError && (
										<ErrorText>{actionData.formError}</ErrorText>
									)}
							</div>
						</Form>
					)}
				</Card>
			)}

			{data.kind === "file" && data.fileRequest && (
				<>
					<Card title="Upload">
						{data.fileRequest.canUpload ? (
							<Form
								method="post"
								encType="multipart/form-data"
								className="flex flex-col gap-3"
							>
								<input type="hidden" name="intent" value="upload" />
								<FilePicker
									name="file"
									accept=".pdf,.ppt,.pptx,.key,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip,.txt,.md"
									constraints={data.uploadConstraints}
									required
								/>
								<div className="flex items-center gap-3">
									<Button type="submit" icon="export" disabled={busy}>
										{data.fileRequest.files.length > 0
											? "Upload new version"
											: "Upload file"}
									</Button>
									{actionData?.intent === "upload" && actionData.formError && (
										<ErrorText>{actionData.formError}</ErrorText>
									)}
									{errs.file?.[0] && <ErrorText>{errs.file[0]}</ErrorText>}
								</div>
							</Form>
						) : (
							<Notice tone="info">
								This request is complete — the event team approved your file.
							</Notice>
						)}
					</Card>

					<Card
						title="Your uploads"
						count={`${data.fileRequest.files.length} version${data.fileRequest.files.length === 1 ? "" : "s"}`}
					>
						{data.fileRequest.files.length === 0 ? (
							<EmptyState
								icon="export"
								title="Nothing uploaded yet"
								body="Upload your file above — the event team reviews it and you'll see the outcome here. Re-uploading keeps every version in the history."
							/>
						) : (
							<div className="flex flex-col gap-4">
								{data.fileRequest.files.map((f) => (
									<div
										key={f.id}
										className="flex flex-col gap-1 border-b border-hair pb-4 last:border-b-0 last:pb-0"
									>
										<div className="flex flex-wrap items-center gap-2">
											<Muted tone="faint">v{f.version}</Muted>
											{f.latest && (
												<StatusBadge tone="info">Latest</StatusBadge>
											)}
											<Strong>{f.fileName}</Strong>
											<StatusBadge tone={f.review.tone}>
												{f.review.label}
											</StatusBadge>
										</div>
										<Muted>
											{f.size} · uploaded {f.uploadedOn} ·{" "}
											<TextLink to={`${data.base}/files/${f.id}`}>
												Download
											</TextLink>
										</Muted>
										{f.latest && f.reviewNote && (
											<Notice tone="danger">
												Reviewer note: {f.reviewNote}
											</Notice>
										)}
										<CommentThread
											action={here}
											fileId={f.id}
											initialCommentKey={f.commentKey}
											comments={f.comments}
											actionData={actionData}
										/>
									</div>
								))}
							</div>
						)}
					</Card>
				</>
			)}
		</div>
	);
}
