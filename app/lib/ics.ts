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
	/**
	 * RFC 5545 revision counter. Calendar clients match on UID and REPLACE the
	 * stored entry when a later payload carries a HIGHER sequence — this is what
	 * makes a schedule-update email move the invite instead of duplicating it.
	 */
	sequence?: number;
	status?: "CONFIRMED";
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
	/** iTIP method — invite/update emails send PUBLISH; feeds omit it. */
	method?: "PUBLISH";
}): string {
	const dtstamp = utcStamp(new Date());
	const lines: string[] = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//OpenRostrum//Program//EN",
		"CALSCALE:GREGORIAN",
	];
	if (options.method) lines.push(`METHOD:${options.method}`);
	lines.push(`X-WR-CALNAME:${escapeText(options.calendarName)}`);
	for (const event of options.events) {
		lines.push(
			"BEGIN:VEVENT",
			`UID:${escapeText(event.uid)}`,
			`DTSTAMP:${dtstamp}`,
			`DTSTART:${utcStamp(event.start)}`,
			`DTEND:${utcStamp(event.end)}`,
			`SUMMARY:${escapeText(event.title)}`,
			`SEQUENCE:${event.sequence ?? 0}`,
		);
		if (event.status) lines.push(`STATUS:${event.status}`);
		if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
		if (event.description)
			lines.push(`DESCRIPTION:${escapeText(event.description)}`);
		lines.push("END:VEVENT");
	}
	lines.push("END:VCALENDAR");
	return `${lines.map(fold).join("\r\n")}\r\n`;
}

export type ParsedIcsEvent = {
	uid: string;
	start: Date;
	end: Date;
	location: string | null;
	sequence: number;
};

function unescapeText(value: string): string {
	let result = "";
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (char !== "\\") {
			result += char;
			continue;
		}
		const escaped = value[index + 1];
		if (escaped === undefined) {
			result += "\\";
			continue;
		}
		if (escaped === "n" || escaped === "N") result += "\n";
		else if (escaped === "\\" || escaped === "," || escaped === ";") {
			result += escaped;
		} else {
			result += `\\${escaped}`;
		}
		index += 1;
	}
	return result;
}

function parseStamp(value: string): Date | null {
	const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value.trim());
	if (!m) return null;
	return new Date(
		Date.UTC(
			Number(m[1]),
			Number(m[2]) - 1,
			Number(m[3]),
			Number(m[4]),
			Number(m[5]),
			Number(m[6]),
		),
	);
}

/**
 * Read back the VEVENTs of an invite WE sent (the `email_outbox` ledger): both
 * this serializer's output and the npm `ics` payloads earlier accept emails
 * attached. UTC-stamped events only; anything unparseable is skipped rather
 * than thrown, so one malformed historic row can't take down change detection.
 */
export function parseIcsAttachment(ics: string): ParsedIcsEvent[] {
	// Unfold RFC 5545 §3.1 continuations, tolerating bare-LF payloads.
	const unfolded = ics.replace(/\r?\n[ \t]/g, "");
	const events: ParsedIcsEvent[] = [];
	for (const block of unfolded.split(/BEGIN:VEVENT/).slice(1)) {
		const body = block.split(/END:VEVENT/)[0] ?? "";
		const prop = (name: string): string | null => {
			// Properties may carry parameters (e.g. "DTSTART;TZID=…:") — match the
			// name at line start up to the first colon. Strip only the CR: TEXT
			// values keep their exact content (a trimmed value would break the
			// sent-vs-current equality the ledger exists for).
			const m = new RegExp(`^${name}[^:\\r\\n]*:(.*?)\\r?$`, "m").exec(body);
			return m?.[1] ?? null;
		};
		const uid = prop("UID");
		const start = parseStamp(prop("DTSTART") ?? "");
		const end = parseStamp(prop("DTEND") ?? "");
		if (!uid || !start || !end) continue;
		const location = prop("LOCATION");
		const sequence = Number(prop("SEQUENCE") ?? "0");
		events.push({
			uid: unescapeText(uid),
			start,
			end,
			location: location ? unescapeText(location) : null,
			sequence: Number.isFinite(sequence) ? sequence : 0,
		});
	}
	return events;
}
