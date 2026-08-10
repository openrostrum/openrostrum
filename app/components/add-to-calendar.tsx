import { useState } from "react";
import { Button } from "~/ui";

/**
 * "Add to calendar" for one public session: downloads the per-session .ics
 * (the agenda feed narrowed to this session's id). Downloads via
 * location.assign — a client-side <Link> to a resource route won't stream the
 * attachment (same pattern as the itinerary's export).
 */
export function AddToCalendar({ href }: { href: string }) {
	const [downloaded, setDownloaded] = useState(false);
	return (
		<div className="flex flex-wrap items-center justify-end gap-3">
			{downloaded && (
				<span className="text-[12.5px] text-fg-muted">
					Download started — import the .ics into your calendar.
				</span>
			)}
			<Button
				type="button"
				variant="ghost"
				icon="calendar"
				onClick={() => {
					window.location.assign(href);
					setDownloaded(true);
				}}
			>
				Add to calendar
			</Button>
		</div>
	);
}
