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

/**
 * The invite's CONTENT, with the render timestamp taken out — what to hash when
 * asking "is this the same invite?". DTSTAMP is minted from the wall clock on
 * every `buildIcs` call (RFC 5545 §3.8.7.2: when the payload was produced, not
 * what it says), so hashing it raw makes two renders of one unchanged invite
 * look like two different invites: a resumed send loses its provider
 * idempotency key and a preview loses its fingerprint match. Everything a
 * calendar client acts on — UID, times, SUMMARY, LOCATION, SEQUENCE — stays in.
 */
export function icsContentFingerprint(ics: string): string {
	return ics.replace(/^DTSTAMP:[^\r\n]*\r?\n/gm, "");
}

export type ParsedIcsEvent = {
	uid: string;
	start: Date;
	end: Date;
	title: string | null;
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
	const [year, month, day, hour, minute, second] = m
		.slice(1)
		.map((component) => Number(component)) as [
		number,
		number,
		number,
		number,
		number,
		number,
	];
	const stamp = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
	if (
		stamp.getUTCFullYear() !== year ||
		stamp.getUTCMonth() !== month - 1 ||
		stamp.getUTCDate() !== day ||
		stamp.getUTCHours() !== hour ||
		stamp.getUTCMinutes() !== minute ||
		stamp.getUTCSeconds() !== second
	) {
		return null;
	}
	return stamp;
}

type IcsEventBlock = { lines: string[]; nested: boolean };

/**
 * Splits VEVENT bodies out of a calendar, rejecting the whole attachment when
 * its envelope is not exactly one balanced VCALENDAR wrapping balanced VEVENTs.
 * A truncated or concatenated fragment is structurally ambiguous — clients may
 * read it differently than we do, so it must never become a delivery baseline.
 */
function scanIcsEventBlocks(
	ics: string,
	maxEvents: number,
): {
	blocks: IcsEventBlock[];
	eventCount: number;
} {
	const lines = ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
	const blocks: IcsEventBlock[] = [];
	let eventCount = 0;
	let body: IcsEventBlock | null = null;
	let inEvent = false;
	let inCalendar = false;
	let calendarsOpened = 0;
	let calendarsClosed = 0;
	let malformed = false;
	for (const line of lines) {
		if (line === "BEGIN:VCALENDAR") {
			if (inCalendar || inEvent) malformed = true;
			inCalendar = true;
			calendarsOpened += 1;
			continue;
		}
		if (line === "END:VCALENDAR") {
			if (!inCalendar || inEvent) malformed = true;
			inCalendar = false;
			calendarsClosed += 1;
			continue;
		}
		if (line === "BEGIN:VEVENT") {
			eventCount += 1;
			if (!inCalendar || inEvent) malformed = true;
			inEvent = true;
			body = eventCount <= maxEvents ? { lines: [], nested: false } : null;
			continue;
		}
		if (line === "END:VEVENT") {
			if (!inEvent) malformed = true;
			if (body !== null) blocks.push(body);
			inEvent = false;
			body = null;
			continue;
		}
		// A component we do not model (VALARM, …) makes this event's properties
		// ambiguous; keep counting it but never trust its parse.
		if (body !== null && line.startsWith("BEGIN:")) body.nested = true;
		body?.lines.push(line);
	}
	if (inEvent || inCalendar || calendarsOpened !== 1 || calendarsClosed !== 1) {
		malformed = true;
	}
	return { blocks: malformed ? [] : blocks, eventCount };
}

/** Groups a VEVENT body by property name, keeping repeats so they can be
 * rejected. Names bind exactly: `UIDX` is not `UID`, and only RFC 5545
 * `;parameters` may follow the name. */
function readEventProperties(lines: readonly string[]): Map<string, string[]> {
	const properties = new Map<string, string[]>();
	for (const line of lines) {
		const colon = line.indexOf(":");
		if (colon < 0) continue;
		const name = line.slice(0, colon).split(";", 1)[0] ?? "";
		// Strip only the CR: TEXT values keep their exact content (a trimmed
		// value would break the sent-vs-current equality the ledger exists for).
		const value = line.slice(colon + 1).replace(/\r$/, "");
		const existing = properties.get(name);
		if (existing) existing.push(value);
		else properties.set(name, [value]);
	}
	return properties;
}

/** Properties this parser reads: a repeat means clients could disagree with us
 * about the delivered schedule, so the event is quarantined rather than read. */
const SINGLETON_ICS_PROPERTIES = [
	"UID",
	"DTSTART",
	"DTEND",
	"SEQUENCE",
	"SUMMARY",
	"LOCATION",
] as const;

export type IcsAttachmentInspection = {
	events: ParsedIcsEvent[];
	eventCount: number;
};

/** Parses supported UTC events while retaining every structural VEVENT count. */
export function inspectIcsAttachment(
	ics: string,
	maxEvents = Number.POSITIVE_INFINITY,
): IcsAttachmentInspection {
	const { blocks, eventCount } = scanIcsEventBlocks(ics, maxEvents);
	if (eventCount > maxEvents) return { events: [], eventCount };
	const events: ParsedIcsEvent[] = [];
	for (const block of blocks) {
		const properties = readEventProperties(block.lines);
		const ambiguous =
			block.nested ||
			SINGLETON_ICS_PROPERTIES.some(
				(name) => (properties.get(name)?.length ?? 0) > 1,
			);
		if (ambiguous) continue;
		const prop = (name: string): string | null =>
			properties.get(name)?.[0] ?? null;
		const uid = prop("UID");
		const start = parseStamp(prop("DTSTART") ?? "");
		const end = parseStamp(prop("DTEND") ?? "");
		const sequenceText = prop("SEQUENCE");
		const sequence = Number(sequenceText ?? "0");
		const validSequence =
			sequenceText === null ||
			(/^\+?\d+$/.test(sequenceText.trim()) && Number.isSafeInteger(sequence));
		if (!uid || !start || !end || !validSequence) continue;
		const title = prop("SUMMARY");
		const location = prop("LOCATION");
		events.push({
			uid: unescapeText(uid),
			start,
			end,
			title: title === null ? null : unescapeText(title),
			location: location ? unescapeText(location) : null,
			sequence,
		});
	}
	return { events, eventCount };
}

export function parseIcsAttachment(ics: string): ParsedIcsEvent[] {
	return inspectIcsAttachment(ics).events;
}
