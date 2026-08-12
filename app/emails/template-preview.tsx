import {
	MERGE_TAGS,
	type MergeContext,
	renderBody,
	renderSubject,
} from "~/lib/email-render";
import { Caps, Panel } from "~/ui";
import { EmailPreview } from "./email-preview";

export function TemplatePreview({
	subject,
	bodyHtml,
	ctx,
}: {
	subject: string;
	bodyHtml: string;
	ctx: MergeContext;
}) {
	return (
		<div className="flex flex-col gap-5">
			<Panel>
				<div className="flex flex-col gap-2">
					<Caps as="h2">
						Preview — merge fields resolved against a sample record
					</Caps>
					<p className="text-[13px] font-medium text-fg">
						{renderSubject(subject, ctx) || "(no subject)"}
					</p>
					<EmailPreview
						html={renderBody(bodyHtml, ctx)}
						title="Rendered email preview"
					/>
				</div>
			</Panel>
			<Panel>
				<div className="flex flex-col gap-2">
					<Caps as="h2">Merge fields</Caps>
					<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
						{MERGE_TAGS.map((t) => (
							<div key={t.tag} className="contents">
								<dt className="font-mono text-[11.5px] text-fg">{`{{${t.tag}}}`}</dt>
								<dd className="text-[12.5px] text-fg-muted">{t.label}</dd>
							</div>
						))}
					</dl>
					<p className="text-[12.5px] text-fg-faint">
						Type a field anywhere in the subject or body — it is replaced per
						recipient at send time.
					</p>
				</div>
			</Panel>
		</div>
	);
}
