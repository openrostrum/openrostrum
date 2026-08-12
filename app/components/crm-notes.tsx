import { Form } from "react-router";
import { formatInTimeZone } from "~/lib/dates";
import { useBusy } from "~/lib/use-busy";
import { Button, Caps, Field, Panel, Textarea } from "~/ui";
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
 * to the hosting route's action. `timeZone` is the event's: "called them
 * Tuesday evening" has to still read as Tuesday evening to the person who
 * wrote it, and it comes from the loader so hydration cannot move it.
 */
export function CrmNotesPanel({
	notes,
	total,
	timeZone,
	error,
}: {
	notes: Note[];
	total: number;
	timeZone: string;
	error?: string;
}) {
	const busy = useBusy();
	return (
		<Panel>
			<div className="flex flex-col gap-3">
				<SectionHeading aside={`${total} total`}>Internal notes</SectionHeading>
				<Form method="post" className="flex flex-col gap-[13px]">
					<Field
						label="Add a note (never visible to the contact)"
						error={error}
					>
						<Textarea name="body" rows={2} />
					</Field>
					<div>
						<Button
							type="submit"
							name="intent"
							value="add-note"
							icon="plus"
							disabled={busy}
						>
							Add note
						</Button>
					</div>
				</Form>
				{notes.length === 0 ? (
					<p className="text-[12.5px] text-fg-faint">
						No notes yet — add the first one above; scouting context and call
						outcomes live here, never visible to the contact.
					</p>
				) : (
					<ul className="flex flex-col gap-3">
						{notes.map((n) => (
							<li key={n.id} className="flex flex-col gap-1">
								<Caps tone="faint">
									{n.authorName} ·{" "}
									{formatInTimeZone(n.createdAt, timeZone, "datetime-zone")}
								</Caps>
								<p className="whitespace-pre-wrap text-[13px] text-fg">
									{n.body}
								</p>
							</li>
						))}
					</ul>
				)}
				{total > notes.length && (
					<p className="text-[12.5px] text-fg-faint">
						Showing the {notes.length} most recent of {total} notes.
					</p>
				)}
			</div>
		</Panel>
	);
}
