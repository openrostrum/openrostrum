import { useState } from "react";
import { EmptyState, SearchInput, StatusBadge, TextLink } from "~/ui";
import { Card, Muted, Row, RowList } from "./bits";
import { ParticipationControls } from "./participation-controls";
import type { SubmissionRowView } from "./types";

export function SubmissionsView({
	base,
	submissions,
}: {
	base: string;
	submissions: SubmissionRowView[];
}) {
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	const filtered = q
		? submissions.filter(
				(s) =>
					s.title.toLowerCase().includes(q) ||
					(s.format ?? "").toLowerCase().includes(q),
			)
		: submissions;

	return (
		<div className="flex flex-col gap-4">
			<SearchInput
				placeholder="Search your submissions…"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				aria-label="Search your submissions"
			/>
			<Card title="My Submissions" count={`${filtered.length} shown`}>
				{submissions.length === 0 ? (
					<EmptyState
						icon="mic"
						title="No submissions yet"
						body="When you submit to this event's call for papers — or an organizer adds you to a session — it appears here with its status."
					/>
				) : filtered.length === 0 ? (
					<EmptyState
						icon="search"
						title="No submissions match"
						body={`Nothing in your submissions matches "${query}". Try a different search, or clear it to see all ${submissions.length}.`}
					/>
				) : (
					<RowList>
						{filtered.map((s) => (
							<Row
								key={s.id}
								right={
									<StatusBadge tone={s.status.tone}>
										{s.status.label}
									</StatusBadge>
								}
							>
								<TextLink to={`${base}/submissions/${s.id}`}>
									{s.title}
								</TextLink>
								{s.format && (
									<div>
										<Muted>{s.format}</Muted>
									</div>
								)}
								{s.participation?.confirmable && (
									<div className="mt-1">
										<ParticipationControls
											action={`${base}/submissions/${s.id}`}
											participation={s.participation}
										/>
									</div>
								)}
							</Row>
						))}
					</RowList>
				)}
			</Card>
		</div>
	);
}
