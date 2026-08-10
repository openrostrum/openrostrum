export interface CsvTable {
	headers: string[];
	/** Data rows, padded/truncated to headers.length. */
	rows: string[][];
}

/**
 * RFC 4180 parser: quoted fields may contain commas, doubled quotes, and
 * embedded newlines — a split-on-newline approach silently corrupts exactly
 * the exports (bios with commas/line breaks) this feeds on.
 */
export function parseCsv(text: string): CsvTable {
	const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const records: string[][] = [];
	let record: string[] = [];
	let field = "";
	let inQuotes = false;
	let sawAny = false;

	const endField = () => {
		record.push(field);
		field = "";
	};
	const endRecord = () => {
		endField();
		// A record whose every field is empty is a blank line, not data.
		if (record.some((f) => f.trim() !== "")) records.push(record);
		record = [];
	};

	for (let i = 0; i < src.length; i += 1) {
		const ch = src[i];
		sawAny = true;
		if (inQuotes) {
			if (ch === '"') {
				if (src[i + 1] === '"') {
					field += '"';
					i += 1;
				} else {
					inQuotes = false;
				}
			} else {
				field += ch;
			}
			continue;
		}
		if (ch === '"' && field === "") {
			inQuotes = true;
		} else if (ch === ",") {
			endField();
		} else if (ch === "\n") {
			endRecord();
		} else if (ch === "\r") {
			if (src[i + 1] === "\n") i += 1;
			endRecord();
		} else {
			field += ch;
		}
	}
	if (sawAny && (field !== "" || record.length > 0)) endRecord();

	const [headers = [], ...rows] = records;
	const width = headers.length;
	return {
		headers: headers.map((h) => h.trim()),
		rows: rows.map((r) =>
			r.length === width
				? r
				: r.length > width
					? r.slice(0, width)
					: [...r, ...Array<string>(width - r.length).fill("")],
		),
	};
}
