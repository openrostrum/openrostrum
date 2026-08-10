import { Form } from "react-router";
import { formatInTz } from "~/lib/format";
import { Button, Field, Panel, Textarea } from "~/ui";
import { SectionHeading } from "./section-heading";

interface Note {
	id: string;
	authorName: string;
	body: string;
	createdAt: Date;
}

/**
 * The person-level internal-note thread — one surface shared by the directory
 * profile and the pipeline card detail. Posts `intent=add-note` with `body`
 * to the hosting route's action.
 */
export function CrmNotesPanel({
	notes,
	total,
	error,
}: {
	notes: Note[];
	total: number;
	error?: string;
}) {
	return (
		<Panel>
			<div className="flex flex-col gap-3">
				<SectionHeading aside={`${total} total`}>Internal notes</SectionHeading>
				<Form method="post" className="flex flex-col gap-3">
					<Field
						label="Add a note (never visible to the contact)"
						error={error}
					>
						<Textarea name="body" rows={2} />
					</Field>
					<div>
						<Button type="submit" name="intent" value="add-note" icon="plus">
							Add note
						</Button>
					</div>
				</Form>
				{notes.length === 0 ? (
					<p className="text-[12.5px] text-fg-faint">
						No notes yet — scouting context and call outcomes live here.
					</p>
				) : (
					<ul className="flex flex-col gap-3">
						{notes.map((n) => (
							<li key={n.id} className="flex flex-col gap-1">
								<span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-faint">
									{n.authorName} · {formatInTz(n.createdAt, "UTC", "datetime")}
								</span>
								<p className="whitespace-pre-wrap text-[13px] text-fg">
									{n.body}
								</p>
							</li>
						))}
					</ul>
				)}
				{total > notes.length && (
					<p className="text-[12px] text-fg-faint">
						Showing the {notes.length} most recent of {total} notes.
					</p>
				)}
			</div>
		</Panel>
	);
}
