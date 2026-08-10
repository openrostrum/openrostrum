import type { loader } from "~/routes/portals.$eventSlug.$portalId.files";
import { ButtonLink, EmptyState } from "~/ui";
import { Card, Muted, Row, RowList, Strong } from "./bits";

export type FilesViewData = Awaited<ReturnType<typeof loader>>["data"];

export function FilesView({ data }: { data: FilesViewData }) {
	return (
		<Card title="Files from the event team" count={String(data.files.length)}>
			{data.files.length === 0 ? (
				<EmptyState
					icon="export"
					title="Nothing shared yet"
					body="Speaker kits, logos, templates, and other files the event team shares with speakers will appear here for download."
				/>
			) : (
				<RowList>
					{data.files.map((f) => (
						<Row
							key={f.id}
							right={
								<ButtonLink to={`${data.base}/files/${f.id}`} variant="ghost">
									Download
								</ButtonLink>
							}
						>
							<Strong>{f.fileName}</Strong>
							<div>
								<Muted>
									{f.size} · shared {f.sharedOn}
								</Muted>
							</div>
						</Row>
					))}
				</RowList>
			)}
		</Card>
	);
}
