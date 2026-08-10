import { useState } from "react";
import { Link } from "react-router";
import {
	Button,
	ButtonLink,
	Chip,
	EmptyState,
	Tab,
	Tabs,
	TextLink,
} from "~/ui";
import {
	DetailPanel,
	makeHref,
	MetaRow,
	Pagination,
	PhotoTile,
	ResultCount,
	ShowMoreText,
	SpeakerPhoto,
	StarButton,
	TagPill,
} from "./bits";
import { FilterBar } from "./filter-bar";
import { useMySchedule } from "./my-schedule";
import { SessionCard, SpeakerRow } from "./session-card";
import type {
	AgendaSurfaceData,
	HideableField,
	ItinerarySurfaceData,
	PublicSession,
	PublicSpeakerProfile,
	SessionsSurfaceData,
	SpeakerDirectoryData,
} from "~/lib/program-types";

/**
 * The five public program surfaces. Each is URL-driven (search, filters,
 * detail, day, page all live in query params) so the same component serves the
 * full pages AND /embed/:publicId — only `base` changes.
 */

/* --------------------------------------------------------------- sessions --- */

export function SessionsSurface({
	data,
	base,
	hidden,
}: {
	data: SessionsSurfaceData;
	base: string;
	hidden?: ReadonlySet<HideableField>;
}) {
	if (!data.hasAnySessions) {
		return (
			<EmptyState
				icon="mic"
				title="No sessions published yet"
				body="The program hasn't been announced for this event. Check back soon."
			/>
		);
	}
	const listState = { ...data.filters, page: data.page };
	if (data.detail) {
		return (
			<SessionDetail
				session={data.detail}
				backHref={makeHref(base, listState)}
				backLabel="All sessions"
				hidden={hidden}
			/>
		);
	}
	const first = (data.page - 1) * data.pageSize + 1;
	const last = first + data.sessions.length - 1;
	return (
		<section className="flex flex-col gap-4">
			<FilterBar
				base={base}
				filters={data.filters}
				facets={data.facets}
				searchPlaceholder="Search titles and speakers…"
			/>
			<ResultCount>
				{data.total === 0
					? "0 sessions"
					: `${first}–${last} of ${data.total} sessions`}
			</ResultCount>
			{data.total === 0 ? (
				<EmptyState
					icon="search"
					title="No sessions match"
					body="Try a different search term, or clear the filters to see the full program."
					action={<TextLink to={base}>Clear search and filters</TextLink>}
				/>
			) : (
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					{data.sessions.map((session) => (
						<SessionCard
							key={session.id}
							session={session}
							hidden={hidden}
							detailHref={makeHref(base, { ...listState, session: session.id })}
						/>
					))}
				</div>
			)}
			<Pagination
				page={data.page}
				pages={data.pages}
				makePageHref={(page) => makeHref(base, { ...data.filters, page })}
			/>
		</section>
	);
}

/* --------------------------------------------------------------- speakers --- */

function SpeakerDetail({
	speaker,
	backHref,
	backLabel,
}: {
	speaker: PublicSpeakerProfile;
	backHref: string;
	backLabel: string;
}) {
	const role = [speaker.jobTitle, speaker.companyName]
		.filter(Boolean)
		.join(", ");
	return (
		<DetailPanel backHref={backHref} backLabel={backLabel}>
			<div className="flex flex-col gap-4">
				<div className="flex items-center gap-4">
					<SpeakerPhoto
						name={speaker.name}
						photoUrl={speaker.photoUrl}
						size={72}
					/>
					<div className="min-w-0">
						<h2 className="font-display text-[20px] font-semibold text-fg">
							{speaker.name}
						</h2>
						{role && <p className="text-[13.5px] text-fg-muted">{role}</p>}
					</div>
				</div>
				{speaker.bio && <ShowMoreText text={speaker.bio} limit={420} />}
				<div className="flex flex-col gap-2 border-t border-hair pt-4">
					<h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
						Sessions ({speaker.sessions.length})
					</h3>
					{speaker.sessions.map((session) => (
						<div key={session.id} className="flex flex-col">
							<p className="text-[13.5px] font-medium text-fg">
								{session.title}
							</p>
							<p className="font-mono text-[11.5px] tabular-nums text-fg-muted">
								{[session.dateLabel, session.timeRange, session.room]
									.filter(Boolean)
									.join(" · ") || "Schedule to be announced"}
							</p>
						</div>
					))}
				</div>
			</div>
		</DetailPanel>
	);
}

export function SpeakersSurface({
	data,
	base,
}: {
	data: SpeakerDirectoryData;
	base: string;
}) {
	if (data.detail) {
		return (
			<SpeakerDetail
				speaker={data.detail}
				backHref={makeHref(base, { q: data.q, page: data.page })}
				backLabel="All speakers"
			/>
		);
	}
	return (
		<section className="flex flex-col gap-4">
			<FilterBar
				base={base}
				filters={{ q: data.q, track: "", format: "", room: "" }}
				facets={{ tracks: [], formats: [], rooms: [] }}
				facetKeys={[]}
				searchPlaceholder="Search speakers by name…"
			/>
			<ResultCount>
				{data.total} speaker{data.total === 1 ? "" : "s"}
			</ResultCount>
			{data.total === 0 ? (
				<EmptyState
					icon="mic"
					title={data.q ? "No speakers match" : "No speakers announced yet"}
					body={
						data.q
							? "Try a different name, or clear the search to see everyone."
							: "Speakers appear here once the organizers publish accepted sessions."
					}
					action={
						data.q ? <TextLink to={base}>Clear search</TextLink> : undefined
					}
				/>
			) : (
				<div className="rounded-card bg-surface shadow-card">
					{data.speakers.map((speaker) => {
						const role = [speaker.jobTitle, speaker.companyName]
							.filter(Boolean)
							.join(", ");
						return (
							<Link
								key={speaker.id}
								to={makeHref(base, {
									speaker: speaker.id,
									q: data.q,
									page: data.page,
								})}
								className="flex items-center gap-3.5 border-t border-hair px-4 py-3 first:border-t-0 hover:bg-row-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-petrol"
							>
								<SpeakerPhoto
									name={speaker.name}
									photoUrl={speaker.photoUrl}
									size={40}
								/>
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="truncate text-[14px] font-medium text-fg">
										{speaker.name}
									</span>
									{role && (
										<span className="truncate text-[12.5px] text-fg-muted">
											{role}
										</span>
									)}
									{speaker.bio && (
										<span className="truncate text-[12.5px] text-fg-faint">
											{speaker.bio}
										</span>
									)}
								</span>
								<span className="shrink-0 font-mono text-[11.5px] text-fg-muted">
									{speaker.sessions.length} session
									{speaker.sessions.length === 1 ? "" : "s"}
								</span>
							</Link>
						);
					})}
				</div>
			)}
			<Pagination
				page={data.page}
				pages={data.pages}
				makePageHref={(page) => makeHref(base, { q: data.q, page })}
			/>
		</section>
	);
}

/* ----------------------------------------------------------------- agenda --- */

const PX_PER_MIN = 1.5;

function SessionDetail({
	session,
	backHref,
	backLabel,
	hidden,
}: {
	session: PublicSession;
	backHref: string;
	backLabel: string;
	/** An embed's hidden card fields stay hidden here too — the detail must
	 * not undo the organizer's embed configuration one click deep. */
	hidden?: ReadonlySet<HideableField>;
}) {
	const show = (field: HideableField) => !hidden?.has(field);
	return (
		<DetailPanel backHref={backHref} backLabel={backLabel}>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-1.5">
					{((show("track") && session.tracks.length > 0) ||
						(show("format") && session.format)) && (
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
					<h2 className="font-display text-[20px] font-semibold leading-snug text-fg">
						{session.title}
					</h2>
				</div>
				<div className="flex flex-col gap-1.5">
					{show("time") && (
						<MetaRow label="Date">
							{session.dateLabel ?? "To be announced"}
						</MetaRow>
					)}
					{show("time") && (
						<MetaRow label="Time">
							{session.timeRange ?? "To be announced"}
						</MetaRow>
					)}
					{show("room") && (
						<MetaRow label="Room">{session.room ?? "To be announced"}</MetaRow>
					)}
					{show("format") && session.format && (
						<MetaRow label="Format">{session.format}</MetaRow>
					)}
					{session.level && <MetaRow label="Level">{session.level}</MetaRow>}
					{session.language && (
						<MetaRow label="Language">{session.language}</MetaRow>
					)}
				</div>
				{show("description") && session.description && (
					<ShowMoreText text={session.description} limit={700} />
				)}
				{show("speakers") && session.speakers.length > 0 && (
					<div className="flex flex-col gap-2.5 border-t border-hair pt-4">
						<h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
							Speakers ({session.speakers.length})
						</h3>
						{session.speakers.map((speaker) => (
							<SpeakerRow key={speaker.id} speaker={speaker} />
						))}
					</div>
				)}
			</div>
		</DetailPanel>
	);
}

export function AgendaSurface({
	data,
	base,
	hidden,
}: {
	data: AgendaSurfaceData;
	base: string;
	hidden?: ReadonlySet<HideableField>;
}) {
	if (data.detail) {
		return (
			<SessionDetail
				session={data.detail}
				backHref={makeHref(base, { day: data.activeDay })}
				backLabel="Back to agenda"
				hidden={hidden}
			/>
		);
	}
	if (data.days.length === 0) {
		return (
			<EmptyState
				icon="calendar"
				title="Nothing scheduled yet"
				body="Sessions appear on the agenda once the organizers place them on the schedule."
			/>
		);
	}
	const dayIndex = data.days.findIndex((d) => d.key === data.activeDay);
	const prevDay = data.days[dayIndex - 1];
	const nextDay = data.days[dayIndex + 1];
	const height = (data.windowEndMin - data.windowStartMin) * PX_PER_MIN;
	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-3">
				<div className="overflow-x-auto">
					<Tabs>
						{data.days.map((day) => (
							<Tab
								key={day.key}
								to={makeHref(base, { day: day.key })}
								active={day.key === data.activeDay}
							>
								{day.label}
							</Tab>
						))}
					</Tabs>
				</div>
				<div className="ml-auto flex items-center gap-2">
					{prevDay && (
						<ButtonLink
							to={makeHref(base, { day: prevDay.key })}
							variant="ghost"
						>
							← {prevDay.label}
						</ButtonLink>
					)}
					{nextDay && (
						<ButtonLink
							to={makeHref(base, { day: nextDay.key })}
							variant="ghost"
						>
							{nextDay.label} →
						</ButtonLink>
					)}
				</div>
			</div>
			{data.dateLabel && (
				<p className="text-[13.5px] font-medium text-fg">{data.dateLabel}</p>
			)}
			<div className="overflow-x-auto rounded-card bg-surface shadow-card">
				<div
					className="flex"
					style={{ minWidth: 56 + data.rooms.length * 200 }}
				>
					<div className="w-14 shrink-0">
						<div className="h-9 border-b border-hair" />
						<div className="relative" style={{ height }}>
							{data.hourMarks.map((mark) => (
								<span
									key={mark.min}
									className="absolute right-2 -translate-y-1/2 font-mono text-[10.5px] tabular-nums text-fg-faint"
									style={{ top: (mark.min - data.windowStartMin) * PX_PER_MIN }}
								>
									{mark.label}
								</span>
							))}
						</div>
					</div>
					{data.rooms.map((room) => (
						<div
							key={room.id}
							className="min-w-[200px] flex-1 border-l border-hair"
						>
							<div className="flex h-9 items-center justify-center border-b border-hair px-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
								{room.name}
							</div>
							<div className="relative" style={{ height }}>
								{data.hourMarks.map((mark) => (
									<div
										key={mark.min}
										aria-hidden="true"
										className="absolute inset-x-0 border-t border-hair"
										style={{
											top: (mark.min - data.windowStartMin) * PX_PER_MIN,
										}}
									/>
								))}
								{room.blocks.map((block) => (
									<Link
										key={block.sessionId}
										to={makeHref(base, {
											day: data.activeDay,
											session: block.sessionId,
										})}
										className="absolute flex flex-col gap-0.5 overflow-hidden rounded-[6px] bg-canvas p-1.5 shadow-control hover:bg-chip focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-petrol"
										style={{
											top:
												(block.startMin - data.windowStartMin) * PX_PER_MIN + 1,
											height: (block.endMin - block.startMin) * PX_PER_MIN - 2,
											left: `${(block.lane / block.laneCount) * 100}%`,
											width: `calc(${100 / block.laneCount}% - 4px)`,
											marginLeft: 2,
										}}
									>
										<span className="font-mono text-[10px] tabular-nums text-fg-muted">
											{block.timeRange}
										</span>
										<span className="text-[12px] font-medium leading-tight text-fg">
											{block.title}
										</span>
										{block.track ? (
											<Chip color={block.track.color}>{block.track.name}</Chip>
										) : (
											block.format && <TagPill>{block.format}</TagPill>
										)}
									</Link>
								))}
							</div>
						</div>
					))}
					{data.rooms.length === 0 && (
						<div className="flex-1">
							<EmptyState
								icon="calendar"
								title="No sessions this day"
								body="Pick another day to see scheduled sessions."
							/>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}

/* -------------------------------------------------------------- itinerary --- */

export function ItinerarySurface({
	data,
	base,
	eventId,
	icsBase,
	hidden,
}: {
	data: ItinerarySurfaceData;
	base: string;
	eventId: string;
	icsBase: string;
	hidden?: ReadonlySet<HideableField>;
}) {
	const schedule = useMySchedule(eventId);
	const [exported, setExported] = useState(false);

	if (data.days.length === 0) {
		return (
			<EmptyState
				icon="calendar"
				title="Nothing scheduled yet"
				body="The itinerary fills in once the organizers place sessions on the schedule."
			/>
		);
	}

	const starredCount = schedule.ready ? schedule.ids.size : 0;
	const dayHref = (key: string) =>
		makeHref(base, { day: key, q: data.filters.q, track: data.filters.track });

	const header = (
		<div className="overflow-x-auto">
			<Tabs>
				{data.days.map((day) => (
					<Tab
						key={day.key}
						to={dayHref(day.key)}
						active={data.view === "day" && day.key === data.activeDay}
					>
						{day.label}
					</Tab>
				))}
				<Tab
					to={makeHref(base, { view: "mine" })}
					active={data.view === "mine"}
					count={schedule.ready ? starredCount : undefined}
				>
					My Schedule
				</Tab>
			</Tabs>
		</div>
	);

	if (data.view === "mine") {
		const starredDays = data.days
			.map((day) => ({
				...day,
				sessions: day.groups
					.flatMap((g) => g.sessions)
					.filter((s) => schedule.ids.has(s.id)),
			}))
			.filter((day) => day.sessions.length > 0);
		const icsHref = `${icsBase}?ids=${[...schedule.ids].join(",")}`;
		return (
			<section className="flex flex-col gap-4">
				{header}
				{!schedule.ready ? (
					<p className="text-[13px] text-fg-muted">Loading your schedule…</p>
				) : starredCount === 0 ? (
					<EmptyState
						icon="star"
						title="Nothing in your schedule yet"
						body="Star sessions on any day to build a personal schedule. It's saved in this browser — no account needed."
						action={
							data.activeDay ? (
								<ButtonLink to={dayHref(data.activeDay)} variant="ghost">
									Browse the itinerary
								</ButtonLink>
							) : undefined
						}
					/>
				) : (
					<>
						<div className="flex flex-wrap items-center gap-3">
							<ResultCount>
								{starredCount} session{starredCount === 1 ? "" : "s"} in your
								schedule
							</ResultCount>
							<div className="ml-auto flex items-center gap-3">
								{exported && (
									<span className="text-[12.5px] text-fg-muted">
										Downloaded — import the .ics into your calendar.
									</span>
								)}
								<Button
									type="button"
									variant="ghost"
									icon="export"
									onClick={() => {
										window.location.assign(icsHref);
										setExported(true);
									}}
								>
									Export .ics
								</Button>
							</div>
						</div>
						{starredDays.map((day) => (
							<div key={day.key} className="flex flex-col gap-3">
								<h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
									{day.dateLabel}
								</h3>
								{day.sessions.map((session) => (
									<SessionCard
										key={session.id}
										session={session}
										showDate={false}
										hidden={hidden}
										action={
											<StarButton
												starred
												title={session.title}
												onToggle={() => schedule.toggle(session.id)}
											/>
										}
									/>
								))}
							</div>
						))}
					</>
				)}
			</section>
		);
	}

	const activeDay = data.days.find((d) => d.key === data.activeDay);
	const filtered = Boolean(data.filters.q || data.filters.track);
	return (
		<section className="flex flex-col gap-4">
			{header}
			<div className="flex flex-wrap items-end justify-between gap-3">
				<FilterBar
					base={base}
					filters={data.filters}
					facets={data.facets}
					facetKeys={["track"]}
					searchPlaceholder="Search titles and speakers…"
					extraParams={{ day: data.activeDay ?? "" }}
				/>
				<TextLink to={icsBase}>Full agenda .ics</TextLink>
			</div>
			{activeDay && (
				<p className="text-[13.5px] font-medium text-fg">
					{activeDay.dateLabel}
				</p>
			)}
			{activeDay && activeDay.groups.length === 0 ? (
				<EmptyState
					icon={filtered ? "search" : "calendar"}
					title={filtered ? "No sessions match" : "No sessions this day"}
					body={
						filtered
							? "Try a different search term, or clear the filters."
							: "Pick another day to see scheduled sessions."
					}
					action={
						filtered ? (
							<TextLink to={makeHref(base, { day: data.activeDay })}>
								Clear search and filters
							</TextLink>
						) : undefined
					}
				/>
			) : (
				activeDay?.groups.map((group) => (
					<div key={group.timeLabel} className="flex flex-col gap-3">
						<h3 className="border-b border-hair pb-1.5 font-mono text-[11.5px] font-medium tabular-nums text-fg-muted">
							{group.timeLabel}
						</h3>
						{group.sessions.map((session) => (
							<SessionCard
								key={session.id}
								session={session}
								showDate={false}
								hidden={hidden}
								action={
									<StarButton
										starred={schedule.ready && schedule.ids.has(session.id)}
										title={session.title}
										onToggle={() => schedule.toggle(session.id)}
									/>
								}
							/>
						))}
					</div>
				))
			)}
		</section>
	);
}

/* ---------------------------------------------------------------- gallery --- */

export function GallerySurface({
	data,
	base,
}: {
	data: SpeakerDirectoryData;
	base: string;
}) {
	if (data.detail) {
		return (
			<SpeakerDetail
				speaker={data.detail}
				backHref={makeHref(base, { q: data.q, page: data.page })}
				backLabel="Back to gallery"
			/>
		);
	}
	return (
		<section className="flex flex-col gap-4">
			<FilterBar
				base={base}
				filters={{ q: data.q, track: "", format: "", room: "" }}
				facets={{ tracks: [], formats: [], rooms: [] }}
				facetKeys={[]}
				searchPlaceholder="Search speakers by name…"
			/>
			<ResultCount>
				{data.total} speaker{data.total === 1 ? "" : "s"}
			</ResultCount>
			{data.total === 0 ? (
				<EmptyState
					icon="mic"
					title={data.q ? "No speakers match" : "No speakers announced yet"}
					body={
						data.q
							? "Try a different name, or clear the search to see everyone."
							: "The gallery fills in once the organizers publish accepted sessions."
					}
					action={
						data.q ? <TextLink to={base}>Clear search</TextLink> : undefined
					}
				/>
			) : (
				<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
					{data.speakers.map((speaker) => (
						<Link
							key={speaker.id}
							to={makeHref(base, {
								speaker: speaker.id,
								q: data.q,
								page: data.page,
							})}
							className="group flex flex-col gap-2 rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol"
						>
							<PhotoTile name={speaker.name} photoUrl={speaker.photoUrl} />
							<span className="flex flex-col">
								<span className="truncate text-[13.5px] font-medium text-fg group-hover:underline group-hover:underline-offset-2">
									{speaker.name}
								</span>
								{(speaker.jobTitle || speaker.companyName) && (
									<span className="truncate text-[12px] text-fg-muted">
										{[speaker.jobTitle, speaker.companyName]
											.filter(Boolean)
											.join(", ")}
									</span>
								)}
							</span>
						</Link>
					))}
				</div>
			)}
			<Pagination
				page={data.page}
				pages={data.pages}
				makePageHref={(page) => makeHref(base, { q: data.q, page })}
			/>
		</section>
	);
}
