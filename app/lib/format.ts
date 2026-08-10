/** Pure formatting helpers — safe on client and server. */

/** Render an epoch in the EVENT's timezone (speakers may be anywhere). */
export function formatInTz(
	date: Date,
	timeZone: string,
	style: "date" | "datetime" = "datetime",
): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone,
		month: "short",
		day: "numeric",
		year: "numeric",
		...(style === "datetime"
			? { hour: "numeric", minute: "2-digit", timeZoneName: "short" }
			: {}),
	}).format(date);
}

export function formatBytes(bytes: number | null | undefined): string {
	if (bytes == null) return "—";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Visible-character count of rich HTML (what the 0/5,000 counter measures). */
export function textLength(html: string): number {
	return html
		.replace(/<[^>]*>/g, "")
		.replace(/&[a-z#0-9]+;/gi, "x")
		.trim().length;
}
