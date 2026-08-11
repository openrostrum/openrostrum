#!/usr/bin/env node
/**
 * Generates twelve authored, faceless PNG portraits and their byte-pinning
 * manifest using only Node built-ins.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const here = path.dirname(new URL(import.meta.url).pathname);
const WIDTH = 512;
const HEIGHT = 512;

function rgb(hex) {
	const value = Number.parseInt(hex.slice(1), 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

function setPixel(pixels, x, y, color) {
	if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
	const offset = (y * WIDTH + x) * 4;
	pixels.set(color, offset);
}

function fill(pixels, color) {
	for (let offset = 0; offset < pixels.length; offset += 4) {
		pixels.set(color, offset);
	}
}

function rect(pixels, x, y, width, height, color) {
	for (let py = Math.max(0, y); py < Math.min(HEIGHT, y + height); py += 1) {
		for (let px = Math.max(0, x); px < Math.min(WIDTH, x + width); px += 1) {
			setPixel(pixels, px, py, color);
		}
	}
}

function rectOutline(pixels, x, y, width, height, thickness, color) {
	rect(pixels, x, y, width, thickness, color);
	rect(pixels, x, y + height - thickness, width, thickness, color);
	rect(pixels, x, y, thickness, height, color);
	rect(pixels, x + width - thickness, y, thickness, height, color);
}

function ellipse(pixels, cx, cy, rx, ry, color) {
	const minX = Math.max(0, Math.floor(cx - rx));
	const maxX = Math.min(WIDTH - 1, Math.ceil(cx + rx));
	const minY = Math.max(0, Math.floor(cy - ry));
	const maxY = Math.min(HEIGHT - 1, Math.ceil(cy + ry));
	for (let y = minY; y <= maxY; y += 1) {
		for (let x = minX; x <= maxX; x += 1) {
			const dx = (x - cx) / rx;
			const dy = (y - cy) / ry;
			if (dx * dx + dy * dy <= 1) setPixel(pixels, x, y, color);
		}
	}
}

function hairBehind(pixels, style, hair) {
	if (["bob", "long", "waves", "braids"].includes(style)) {
		ellipse(
			pixels,
			256,
			245,
			style === "bob" ? 105 : 116,
			style === "bob" ? 126 : 160,
			hair,
		);
	}
	if (style === "braids") {
		for (const x of [168, 184, 328, 344]) {
			for (const y of [210, 250, 290, 330]) ellipse(pixels, x, y, 16, 26, hair);
		}
	}
	if (style === "bun") ellipse(pixels, 304, 112, 42, 38, hair);
}

function hairFront(pixels, style, hair) {
	const dimensions = style === "crop" ? [82, 42] : [92, 54];
	ellipse(pixels, 256, 154, dimensions[0], dimensions[1], hair);
	if (style === "sidepart") ellipse(pixels, 222, 173, 62, 38, hair);
	if (style === "fringe") {
		for (const x of [198, 226, 254, 282, 310])
			ellipse(pixels, x, 180, 28, 35, hair);
	}
	if (style === "curls") {
		for (const [x, y] of [
			[184, 176],
			[218, 145],
			[256, 136],
			[294, 145],
			[328, 176],
		]) {
			ellipse(pixels, x, y, 28, 26, hair);
		}
	}
}

function portrait(spec) {
	const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
	const colors = Object.fromEntries(
		Object.entries(spec.colors).map(([name, hex]) => [name, rgb(hex)]),
	);
	fill(pixels, colors.bg);
	ellipse(pixels, 256, 500, 315, 310, colors.accent);
	hairBehind(pixels, spec.style, colors.hair);
	rect(pixels, 228, 286, 56, 110, colors.skinShade);
	ellipse(pixels, 256, 500, 172, 132, colors.shirt);
	rect(pixels, 238, 372, 36, 20, colors.collar);
	ellipse(pixels, 256, 224, 84, 98, colors.skin);
	hairFront(pixels, spec.style, colors.hair);
	if (spec.beard) ellipse(pixels, 256, 284, 66, 48, colors.hair);
	if (spec.glasses) {
		rectOutline(pixels, 190, 218, 50, 32, 6, colors.detail);
		rectOutline(pixels, 272, 218, 50, 32, 6, colors.detail);
		rect(pixels, 240, 230, 32, 6, colors.detail);
	}
	if (spec.earrings) {
		ellipse(pixels, 184, 286, 13, 18, colors.detail);
		ellipse(pixels, 328, 286, 13, 18, colors.detail);
		ellipse(pixels, 184, 286, 6, 10, colors.bg);
		ellipse(pixels, 328, 286, 6, 10, colors.bg);
	}
	return encodePng(pixels);
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) {
		value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	}
	return value >>> 0;
});

function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const name = Buffer.from(type, "ascii");
	const output = Buffer.alloc(data.length + 12);
	output.writeUInt32BE(data.length, 0);
	name.copy(output, 4);
	data.copy(output, 8);
	output.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
	return output;
}

function encodePng(pixels) {
	const stride = WIDTH * 4 + 1;
	const scanlines = Buffer.alloc(stride * HEIGHT);
	for (let y = 0; y < HEIGHT; y += 1) {
		const row = y * stride;
		scanlines[row] = 0;
		Buffer.from(pixels.buffer, y * WIDTH * 4, WIDTH * 4).copy(
			scanlines,
			row + 1,
		);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(WIDTH, 0);
	header.writeUInt32BE(HEIGHT, 4);
	header[8] = 8;
	header[9] = 6;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(scanlines, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

const speakers = [
	{
		contactId: "c_sam",
		fileName: "sam-speaker.png",
		style: "sidepart",
		colors: {
			bg: "#E7EFE4",
			accent: "#DCE7D8",
			skin: "#E8B48C",
			skinShade: "#D9A076",
			shirt: "#0E6C66",
			collar: "#0A5750",
			hair: "#4A342A",
			detail: "#3B302A",
		},
	},
	{
		contactId: "c_alex",
		fileName: "alex-co.png",
		style: "waves",
		colors: {
			bg: "#E3EBF2",
			accent: "#D7E2EC",
			skin: "#F1C9A5",
			skinShade: "#E2B58C",
			shirt: "#B2604E",
			collar: "#9E5343",
			hair: "#6E3A26",
			detail: "#443A35",
		},
	},
	{
		contactId: "c_noor",
		fileName: "noor-haddad.png",
		style: "long",
		earrings: true,
		colors: {
			bg: "#F2E9DC",
			accent: "#EADDC9",
			skin: "#C68B59",
			skinShade: "#B57A49",
			shirt: "#2A3331",
			collar: "#171A19",
			hair: "#201B18",
			detail: "#D9A441",
		},
	},
	{
		contactId: "c_marco",
		fileName: "marco-silva.png",
		style: "curls",
		beard: true,
		colors: {
			bg: "#F0E4E0",
			accent: "#E7D5CF",
			skin: "#B87749",
			skinShade: "#A66739",
			shirt: "#4A6B8A",
			collar: "#3E5A75",
			hair: "#201B18",
			detail: "#443A35",
		},
	},
	{
		contactId: "c_dana",
		fileName: "dana-fields.png",
		style: "fringe",
		colors: {
			bg: "#EAE6F2",
			accent: "#DFD9EC",
			skin: "#EFC1A6",
			skinShade: "#DFAD8E",
			shirt: "#6E5A7E",
			collar: "#5D4B6B",
			hair: "#B9BDBB",
			detail: "#4B4550",
		},
	},
	{
		contactId: "c_lena",
		fileName: "lena-ortiz.png",
		style: "bun",
		earrings: true,
		colors: {
			bg: "#E4F0EE",
			accent: "#D6E8E4",
			skin: "#8D5A3B",
			skinShade: "#7C4C2F",
			shirt: "#4E6E5D",
			collar: "#405D4C",
			hair: "#26201C",
			detail: "#D9A441",
		},
	},
	{
		contactId: "c_maya",
		fileName: "maya-chen.png",
		style: "bob",
		colors: {
			bg: "#E8EDF5",
			accent: "#D9E1EF",
			skin: "#D8A37B",
			skinShade: "#C58E67",
			shirt: "#334E68",
			collar: "#263E55",
			hair: "#241F1C",
			detail: "#443A35",
		},
	},
	{
		contactId: "c_priya",
		fileName: "priya-narayanan.png",
		style: "bun",
		glasses: true,
		colors: {
			bg: "#F3E9DF",
			accent: "#E8D8C9",
			skin: "#A96D48",
			skinShade: "#945B39",
			shirt: "#704A6A",
			collar: "#5E3C59",
			hair: "#241B18",
			detail: "#443A35",
		},
	},
	{
		contactId: "c_yuki",
		fileName: "yuki-tanaka.png",
		style: "fringe",
		colors: {
			bg: "#E6F0EA",
			accent: "#D8E8DE",
			skin: "#E3B08A",
			skinShade: "#D09A74",
			shirt: "#5B6F52",
			collar: "#495E42",
			hair: "#25211F",
			detail: "#443A35",
		},
	},
	{
		contactId: "c_amina",
		fileName: "amina-okafor.png",
		style: "braids",
		colors: {
			bg: "#F0E8F3",
			accent: "#E3D7E9",
			skin: "#74472F",
			skinShade: "#633A25",
			shirt: "#8A5A3B",
			collar: "#71482F",
			hair: "#201A18",
			detail: "#D9A441",
		},
	},
	{
		contactId: "c_sofia",
		fileName: "sofia-alvarez.png",
		style: "waves",
		colors: {
			bg: "#F5E8E5",
			accent: "#EBD7D2",
			skin: "#C98D67",
			skinShade: "#B77955",
			shirt: "#9A4F55",
			collar: "#823F46",
			hair: "#5A3326",
			detail: "#443A35",
		},
	},
	{
		contactId: "c_rohan",
		fileName: "rohan-mehta.png",
		style: "crop",
		beard: true,
		colors: {
			bg: "#E5EEF0",
			accent: "#D6E5E8",
			skin: "#B77850",
			skinShade: "#A4653F",
			shirt: "#416A73",
			collar: "#345961",
			hair: "#2B211C",
			detail: "#443A35",
		},
	},
];

const manifest = [];
for (const speaker of speakers) {
	const png = portrait(speaker);
	writeFileSync(path.join(here, speaker.fileName), png);
	manifest.push({
		contactId: speaker.contactId,
		fileName: speaker.fileName,
		r2Key: `headshots/e_demo/${speaker.contactId}/seed.png`,
		contentType: "image/png",
		sizeBytes: png.length,
		sha256: createHash("sha256").update(png).digest("hex"),
	});
	console.log(`wrote ${speaker.fileName} (${png.length} bytes)`);
}
writeFileSync(
	path.join(here, "manifest.json"),
	`${JSON.stringify(manifest, null, "\t")}\n`,
);
console.log("wrote manifest.json");
