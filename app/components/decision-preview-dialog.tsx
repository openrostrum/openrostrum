import type { DecisionEmailPreview } from "~/domain/accept";
import { EmailPreview } from "~/emails/email-preview";
import { Button, ErrorText, Field, Modal, Panel, Select } from "~/ui";

export function DecisionPreviewDialog({
	open,
	decision,
	preview,
	skipped,
	activeIndex,
	loading,
	error,
	onSelectRecipient,
	onRefresh,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	decision: "accept" | "decline" | null;
	preview: DecisionEmailPreview | null;
	skipped?: string[];
	activeIndex: number;
	loading: boolean;
	error?: string;
	onSelectRecipient: (index: number) => void;
	onRefresh: () => void;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	if (!decision) return null;
	const recipient = preview?.recipients[activeIndex];
	const label = decision === "accept" ? "acceptance" : "decline";
	const actions = (
		<>
			{error && (
				<Button type="button" variant="ghost" onClick={onRefresh}>
					Refresh preview
				</Button>
			)}
			<Button type="button" variant="ghost" onClick={onCancel}>
				Cancel
			</Button>
			<Button
				type="button"
				disabled={
					loading || !preview || preview.recipients.length === 0 || !!error
				}
				onClick={onConfirm}
			>
				Send {preview?.recipients.length ?? 0} {label} email
				{preview?.recipients.length === 1 ? "" : "s"} and finalize
			</Button>
		</>
	);
	return (
		<Modal
			open={open}
			title={`Review ${label} emails`}
			subtitle="Nothing is sent or finalized until you confirm below."
			onClose={onCancel}
			actions={actions}
		>
			{loading && !preview && <p>Preparing exact recipient previews…</p>}
			{error && <ErrorText>{error}</ErrorText>}
			{preview && (
				<>
					<Panel>
						<div className="grid gap-2 sm:grid-cols-3">
							<div>
								<strong>{preview.recipients.length}</strong> deliverable
								recipient
								{preview.recipients.length === 1 ? "" : "s"}
							</div>
							<div>
								Template: <strong>{preview.template.name}</strong>
							</div>
							<div>Reply-to: {preview.template.replyTo ?? "event default"}</div>
						</div>
					</Panel>

					{skipped && skipped.length > 0 && (
						<div className="flex flex-col gap-1">
							<strong>Not deliverable</strong>
							{skipped.map((item) => (
								<ErrorText key={item}>{item}</ErrorText>
							))}
						</div>
					)}

					{recipient ? (
						<div className="flex flex-col gap-3">
							<Field label="Exact recipient" composite>
								<Select
									aria-label="Preview recipient"
									value={activeIndex}
									onChange={(event) =>
										onSelectRecipient(Number(event.currentTarget.value))
									}
								>
									{preview.recipients.map((item, index) => (
										<option key={item.submissionId} value={index}>
											{item.title} — {item.to}
										</option>
									))}
								</Select>
							</Field>
							<div className="flex min-w-0 flex-col gap-2">
								<p>
									<strong>To:</strong> {recipient.to}
								</p>
								<p>
									<strong>Subject:</strong> {recipient.subject}
								</p>
								<p>
									{recipient.hasCalendarAttachment
										? "Calendar invite attached"
										: "No calendar attachment"}
								</p>
								<EmailPreview
									html={recipient.html}
									title={`Rendered ${label} email for ${recipient.to}`}
								/>
							</div>
						</div>
					) : (
						<ErrorText>
							No selected submissions have an email recipient.
						</ErrorText>
					)}
				</>
			)}
		</Modal>
	);
}
