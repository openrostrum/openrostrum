import { and, desc, eq } from "drizzle-orm";
import { data } from "react-router";
import { FilesView } from "~/components/portal/files-view";
import { getDb } from "~/db";
import { files } from "~/db/schema";
import { getPortalContext, portalPath } from "~/domain/portal";
import { requireUser } from "~/lib/auth";
import { formatBytes, formatInTz } from "~/lib/format";
import { createTimings } from "~/lib/track";
import type { Route } from "./+types/portals.$eventSlug.$portalId.files";

export function headers({ loaderHeaders }: Route.HeadersArgs) {
	return loaderHeaders;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const user = await requireUser(env, request);
	const ctx = await getPortalContext(env, user, params, request);
	const db = getDb(env);
	const timings = createTimings();
	// Only rows the organizer explicitly shared to the portal — the payload
	// carries file ids and display metadata, never r2 keys.
	const rows = await timings.time("db", () =>
		db
			.select({
				id: files.id,
				fileName: files.fileName,
				sizeBytes: files.sizeBytes,
				createdAt: files.createdAt,
			})
			.from(files)
			.where(
				and(eq(files.eventId, ctx.event.id), eq(files.sharedToPortal, true)),
			)
			.orderBy(desc(files.createdAt)),
	);
	return data(
		{
			base: portalPath(ctx),
			files: rows.map((f) => ({
				id: f.id,
				fileName: f.fileName,
				size: formatBytes(f.sizeBytes),
				sharedOn: formatInTz(f.createdAt, ctx.event.timezone, "date"),
			})),
		},
		{ headers: { "Server-Timing": timings.header() } },
	);
}

export default function PortalFiles({ loaderData }: Route.ComponentProps) {
	return <FilesView data={loaderData} />;
}
