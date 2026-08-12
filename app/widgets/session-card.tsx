import type { ReactNode } from "react";
import { Chip, InkLink } from "~/ui";
import { ShowMoreText, SpeakerPhoto, TagPill } from "./bits";
import type { HideableField, PublicSession } from "~/lib/program-types";

export function SpeakerRow({
	speaker,
	detailHref,
}: {
	speaker: PublicSession["speakers"][number];
	detailHref?: string;
}) {
	const role = [speaker.jobTitle, speaker.companyName]
		.filter(Boolean)
		.join(", ");
	const content = (
		<>
			<SpeakerPhoto name={speaker.name} photoUrl={speaker.photoUrl} size={30} />
			<div className="min-w-0">
				<p className="truncate text-[13px] font-medium text-fg">
					{speaker.name}
				</p>
				{role && <p className="truncate text-[12px] text-fg-muted">{role}</p>}
			</div>
		</>
	);
	return detailHref ? (
		<InkLink to={detailHref} row>
			{content}
		</InkLink>
	) : (
		<div className="flex items-center gap-2.5">{content}</div>
	);
}

/**
 * The full public card anatomy: tags, title, date/time + room, description
 * with Show more, speakers with title + company. `hidden` carries an embed's
 * field selection; the full pages pass none.
 */
export function SessionCard({
	session,
	hidden,
	showDate = true,
	action,
	detailHref,
}: {
	session: PublicSession;
	hidden?: ReadonlySet<HideableField>;
	showDate?: boolean;
	action?: ReactNode;
	/** When set, the card title links to the session's detail view. */
	detailHref?: string;
}) {
	const show = (field: HideableField) => !hidden?.has(field);
	const timeLine = [showDate ? session.dayLabel : null, session.timeRange]
		.filter(Boolean)
		.join(" · ");
	return (
		<article className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card">
			<div className="flex items-start gap-3">
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					{(show("track") || show("format")) &&
						(session.tracks.length > 0 || session.format) && (
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
								{show("track") &&
									session.tracks.map((track) => (
										<Chip key={track.id} color={track.color}>
											{track.name}
										</Chip>
									))}
								{show("format") && session.format && (
									<TagPill>{session.format}</TagPill>
								)}
							</div>
						)}
					<h3 className="font-display text-[16px] font-semibold leading-snug text-fg">
						{detailHref ? (
							<InkLink to={detailHref}>{session.title}</InkLink>
						) : (
							session.title
						)}
					</h3>
					{show("time") && (
						<p className="font-mono text-[11.5px] tabular-nums text-fg-muted">
							{session.scheduled ? timeLine : "Schedule to be announced"}
							{show("room") && session.room ? ` · ${session.room}` : ""}
						</p>
					)}
				</div>
				{action}
			</div>
			{show("description") && session.description && (
				<ShowMoreText text={session.description} />
			)}
			{show("speakers") && session.speakers.length > 0 && (
				<div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-hair pt-3">
					{session.speakers.map((speaker) => (
						<SpeakerRow key={speaker.id} speaker={speaker} />
					))}
				</div>
			)}
		</article>
	);
}
