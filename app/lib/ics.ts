/**
 * Dependency-free iCalendar (RFC 5545) serializer — the npm `ics` package
 * cannot load in workerd (its yup→property-expr CJS chain breaks under the
 * vitest workers pool). Pure function; identical in tests, dev, and prod.
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

const encoder = new TextEncoder();

/** RFC 5545 §3.1: fold lines over 75 OCTETS (continuations carry a leading
 * space), counted in UTF-8 bytes per code point so no character splits. */
function fold(line: string): string {
	const chunks: string[] = [];
	let current = "";
	let octets = 0;
	for (const ch of line) {
		const chOctets = encoder.encode(ch).length;
		const max = chunks.length === 0 ? 75 : 74;
		if (octets + chOctets > max && current !== "") {
			chunks.push(current);
			current = ch;
			octets = chOctets;
		} else {
			current += ch;
			octets += chOctets;
		}
	}
	chunks.push(current);
	return chunks.map((c, i) => (i === 0 ? c : ` ${c}`)).join("\r\n");
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
