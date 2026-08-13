#!/usr/bin/env node
/**
 * Generates three deterministic, valid speaker-deck PDFs and a byte-pinning
 * manifest. The files are intentionally small but contain real multi-page slide
 * content, so the seeded file library, portal download, and R2 paths exercise
 * PDF behavior rather than placeholder text files.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);

const decks = [
	{
		submissionId: "s_accepted",
		fileName: "rag-to-riches.pdf",
		r2Key: "slides/e_demo/s_accepted/v1.pdf",
		pages: [
			[
				"FROM RAG TO RICHES",
				"Retrieval systems that survive production",
				"Samira Cole + Alex Moreau",
			],
			[
				"THE THREE REBUILDS",
				"1. Vector search",
				"2. Hybrid retrieval",
				"3. Freshness as infrastructure",
			],
			[
				"WHAT MOVED QUALITY",
				"Metadata filters beat model upgrades",
				"Canaries catch embedding drift",
				"Measure the queries users actually ask",
			],
		],
	},
	{
		submissionId: "s_open_keynote",
		fileName: "opening-keynote.pdf",
		r2Key: "slides/e_demo/s_open_keynote/v1.pdf",
		pages: [
			[
				"THE STATE OF AI ENGINEERING",
				"A field report from production teams",
				"Maya Chen - Northstar Systems",
			],
			[
				"WHAT BECAME STANDARD",
				"Evals in CI",
				"Retrieval as infrastructure",
				"Structured output everywhere",
			],
			[
				"WHAT IS STILL HARD",
				"Durable memory",
				"Multi-step reliability",
				"Cost attribution that teams trust",
			],
		],
	},
	{
		submissionId: "s_evals_ws",
		fileName: "evals-from-scratch.pdf",
		r2Key: "slides/e_demo/s_evals_ws/v1.pdf",
		pages: [
			[
				"EVALS FROM SCRATCH",
				"Build a regression gate in 90 minutes",
				"Eli Rosenberg - Proofpoint AI",
			],
			[
				"THE HARNESS",
				"Golden cases from real incidents",
				"Exact and rubric graders",
				"Cached runs with reproducible outputs",
			],
			[
				"THE RELEASE GATE",
				"Compare against the accepted baseline",
				"Inspect every regression",
				"Ship only when the evidence is green",
			],
		],
	},
];

function pdfString(value) {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("(", "\\(")
		.replaceAll(")", "\\)");
}

function pageStream(lines) {
	const commands = ["BT", "/F1 30 Tf", "72 700 Td"];
	for (const [index, line] of lines.entries()) {
		if (index === 1) commands.push("/F1 18 Tf");
		if (index > 0) commands.push("0 -54 Td");
		commands.push(`(${pdfString(line)}) Tj`);
	}
	commands.push("ET");
	return `${commands.join("\n")}\n`;
}

function makePdf(pages) {
	const streams = pages.map(pageStream);
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 9 0 R >> >> /Contents 4 0 R >>",
		`<< /Length ${Buffer.byteLength(streams[0])} >>\nstream\n${streams[0]}endstream`,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 9 0 R >> >> /Contents 6 0 R >>",
		`<< /Length ${Buffer.byteLength(streams[1])} >>\nstream\n${streams[1]}endstream`,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 9 0 R >> >> /Contents 8 0 R >>",
		`<< /Length ${Buffer.byteLength(streams[2])} >>\nstream\n${streams[2]}endstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
	const offsets = [];
	let length = chunks[0].length;
	for (const [index, object] of objects.entries()) {
		offsets.push(length);
		const chunk = Buffer.from(
			`${index + 1} 0 obj\n${object}\nendobj\n`,
			"ascii",
		);
		chunks.push(chunk);
		length += chunk.length;
	}
	const xrefOffset = length;
	const xref = [
		"xref",
		`0 ${objects.length + 1}`,
		"0000000000 65535 f ",
		...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
		"trailer",
		`<< /Size ${objects.length + 1} /Root 1 0 R >>`,
		"startxref",
		String(xrefOffset),
		"%%EOF",
		"",
	].join("\n");
	chunks.push(Buffer.from(xref, "ascii"));
	return Buffer.concat(chunks);
}

const manifest = [];
for (const deck of decks) {
	const pdf = makePdf(deck.pages);
	writeFileSync(path.join(here, deck.fileName), pdf);
	manifest.push({
		submissionId: deck.submissionId,
		fileName: deck.fileName,
		r2Key: deck.r2Key,
		contentType: "application/pdf",
		sizeBytes: pdf.length,
		sha256: createHash("sha256").update(pdf).digest("hex"),
		version: 1,
	});
	console.log(`wrote ${deck.fileName} (${pdf.length} bytes)`);
}
writeFileSync(
	path.join(here, "manifest.json"),
	`${JSON.stringify(manifest, null, "\t")}\n`,
);
console.log("wrote manifest.json");
