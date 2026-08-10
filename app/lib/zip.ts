/**
 * Minimal streaming ZIP writer (STORE + data descriptors): entry bodies
 * stream from R2 into the response without buffering, and STORE keeps CPU
 * flat (decks/images are already compressed). No zip64 — callers cap size.
 */

export type ZipEntrySource = {
	/** Forward-slash path inside the archive, e.g. "Session A/slides.pdf". */
	path: string;
	body: ReadableStream<Uint8Array> | Uint8Array;
};

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(bytes: Uint8Array, seed = 0): number {
	let c = ~seed >>> 0;
	for (const byte of bytes) {
		c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
	}
	return ~c >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
	return {
		time:
			(date.getHours() << 11) |
			(date.getMinutes() << 5) |
			(date.getSeconds() >> 1),
		date:
			(Math.max(0, date.getFullYear() - 1980) << 9) |
			((date.getMonth() + 1) << 5) |
			date.getDate(),
	};
}

function le(bytes: number, ...fields: Array<[value: number, size: 2 | 4]>) {
	const buf = new Uint8Array(bytes);
	const view = new DataView(buf.buffer);
	let offset = 0;
	for (const [value, size] of fields) {
		if (size === 2) view.setUint16(offset, value & 0xffff, true);
		else view.setUint32(offset, value >>> 0, true);
		offset += size;
	}
	return buf;
}

type CentralRecord = {
	nameBytes: Uint8Array;
	crc: number;
	size: number;
	offset: number;
	time: number;
	date: number;
};

// General-purpose flags: bit 3 (sizes/CRC in a trailing data descriptor,
// required for streaming) + bit 11 (UTF-8 names).
const FLAGS = 0x0808;

/**
 * Streams a ZIP archive from an async sequence of entries. Entries are pulled
 * lazily — an R2 body is only opened when the archive reaches it.
 */
export function zipStream(
	entries: AsyncIterable<ZipEntrySource> | Iterable<ZipEntrySource>,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const central: CentralRecord[] = [];
	let offset = 0;

	async function* generate(): AsyncGenerator<Uint8Array> {
		for await (const entry of entries) {
			const nameBytes = encoder.encode(entry.path);
			const { time, date } = dosDateTime(new Date());
			const headerOffset = offset;
			const header = le(
				30,
				[0x04034b50, 4], // local file header signature
				[20, 2], // version needed
				[FLAGS, 2],
				[0, 2], // method: STORE
				[time, 2],
				[date, 2],
				[0, 4], // crc (in descriptor)
				[0, 4], // compressed size (in descriptor)
				[0, 4], // uncompressed size (in descriptor)
				[nameBytes.length, 2],
				[0, 2], // extra length
			);
			yield header;
			yield nameBytes;
			offset += header.length + nameBytes.length;

			let crc = 0;
			let size = 0;
			if (entry.body instanceof Uint8Array) {
				crc = crc32(entry.body);
				size = entry.body.length;
				yield entry.body;
			} else {
				const reader = entry.body.getReader();
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					crc = crc32(value, crc);
					size += value.length;
					yield value;
				}
			}
			offset += size;

			const descriptor = le(
				16,
				[0x08074b50, 4], // data descriptor signature
				[crc, 4],
				[size, 4], // compressed (STORE: equals uncompressed)
				[size, 4],
			);
			yield descriptor;
			offset += descriptor.length;
			central.push({ nameBytes, crc, size, offset: headerOffset, time, date });
		}

		const centralStart = offset;
		for (const record of central) {
			const entryHeader = le(
				46,
				[0x02014b50, 4], // central directory signature
				[20, 2], // version made by
				[20, 2], // version needed
				[FLAGS, 2],
				[0, 2], // method
				[record.time, 2],
				[record.date, 2],
				[record.crc, 4],
				[record.size, 4],
				[record.size, 4],
				[record.nameBytes.length, 2],
				[0, 2], // extra
				[0, 2], // comment
				[0, 2], // disk
				[0, 2], // internal attrs
				[0, 4], // external attrs
				[record.offset, 4],
			);
			yield entryHeader;
			yield record.nameBytes;
			offset += entryHeader.length + record.nameBytes.length;
		}
		yield le(
			22,
			[0x06054b50, 4], // end of central directory
			[0, 2], // disk
			[0, 2], // cd disk
			[central.length, 2],
			[central.length, 2],
			[offset - centralStart, 4],
			[centralStart, 4],
			[0, 2], // comment length
		);
	}

	const iterator = generate();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const { done, value } = await iterator.next();
			if (done) controller.close();
			else controller.enqueue(value);
		},
		async cancel() {
			await iterator.return?.(undefined);
		},
	});
}
