/**
 * Dependency-free iCalendar (RFC 5545) serializer. The npm `ics` package
 * cannot load in workerd (its yup→property-expr CJS chain breaks under the
 * vitest workers pool), so calendar output is generated here — a pure
 * function that behaves identically in tests, dev, and prod.
 */

export type IcsEvent = {
	uid: string;
	start: Date;
	end: Date;
	title: string;
	description?: string;
	location?: string;
};

function escapeText(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\r?\n/g, "\\n");
}

function utcStamp(date: Date): string {
	return date
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z");
}

/** RFC 5545 §3.1: content lines longer than 75 octets fold with CRLF + space. */
function fold(line: string): string {
	if (line.length <= 74) return line;
	const chunks: string[] = [];
	let rest = line;
	while (rest.length > 74) {
		chunks.push(rest.slice(0, 74));
		rest = ` ${rest.slice(74)}`;
	}
	chunks.push(rest);
	return chunks.join("\r\n");
}

export function buildIcs(options: {
	calendarName: string;
	events: IcsEvent[];
}): string {
	const dtstamp = utcStamp(new Date());
	const lines: string[] = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//OpenRostrum//Program//EN",
		"CALSCALE:GREGORIAN",
		`X-WR-CALNAME:${escapeText(options.calendarName)}`,
	];
	for (const event of options.events) {
		lines.push(
			"BEGIN:VEVENT",
			`UID:${escapeText(event.uid)}`,
			`DTSTAMP:${dtstamp}`,
			`DTSTART:${utcStamp(event.start)}`,
			`DTEND:${utcStamp(event.end)}`,
			`SUMMARY:${escapeText(event.title)}`,
			"SEQUENCE:0",
		);
		if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
		if (event.description)
			lines.push(`DESCRIPTION:${escapeText(event.description)}`);
		lines.push("END:VEVENT");
	}
	lines.push("END:VCALENDAR");
	return `${lines.map(fold).join("\r\n")}\r\n`;
}
