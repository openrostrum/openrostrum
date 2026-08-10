import { Panel } from "~/ui";
import { EmailPreview } from "./email-preview";

export interface HistoryDetailEmail {
	to: string;
	replyTo: string | null;
	subject: string;
	statusLabel: string;
	sentAtLabel: string;
	templateName: string | null;
	error: string | null;
	hasIcs: boolean;
	html: string;
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="contents">
			<dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
				{label}
			</dt>
			<dd className="text-[13px] text-fg">{value}</dd>
		</div>
	);
}

/** The expanded view of one sent email — the delivery evidence an organizer
 * (or the judging harness) reads: envelope fields + the frozen body snapshot. */
export function HistoryDetail({
	email,
	closeAction,
}: {
	email: HistoryDetailEmail;
	closeAction: React.ReactNode;
}) {
	return (
		<Panel>
			<div className="flex flex-col gap-3">
				<div className="flex items-start justify-between gap-3">
					<dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1">
						<Row label="To" value={email.to} />
						<Row label="Reply-to" value={email.replyTo ?? "—"} />
						<Row label="Subject" value={email.subject} />
						<Row label="Template" value={email.templateName ?? "—"} />
						<Row label="Status" value={email.statusLabel} />
						<Row label="Sent" value={email.sentAtLabel} />
						{email.hasIcs && (
							<Row label="Attachment" value="invite.ics (calendar invite)" />
						)}
						{email.error && <Row label="Error" value={email.error} />}
					</dl>
					{closeAction}
				</div>
				<EmailPreview html={email.html} title={`Email to ${email.to}`} />
			</div>
		</Panel>
	);
}
