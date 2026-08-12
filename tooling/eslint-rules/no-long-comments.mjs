// A comment past a few lines is usually code that never got clarified, or
// rationale that belongs in docs/ where an owner will find it. Consecutive
// `//` lines count as ONE comment — the repo writes its blocks that way, and
// per-line counting would make the ceiling unenforceable.
const DEFAULT_MAX_LINES = 4;

// A comment trailing code (`foo(); // why`) starts its own block: the code
// between it and the previous line breaks the run.
function isTrailing(sourceCode, comment) {
	const before = sourceCode.getTokenBefore(comment, { includeComments: false });
	return before != null && before.loc.end.line === comment.loc.start.line;
}

// The ceiling counts lines of PROSE, so the same rationale costs the same as a
// `//` run and as a JSDoc block. A bare `/**` or `*/` carries no words; a blank
// `*` line does count, so a two-paragraph essay still trips either way.
function proseLines(sourceCode, block) {
	let count = 0;
	for (
		let line = block.start.loc.start.line;
		line <= block.end.loc.end.line;
	) {
		const text = sourceCode.lines[line - 1].trim();
		if (text !== "/**" && text !== "/*" && text !== "*/") count += 1;
		line += 1;
	}
	return count;
}

function blocksOf(sourceCode) {
	const blocks = [];
	let open = null;
	for (const comment of sourceCode.getAllComments()) {
		const trailing = isTrailing(sourceCode, comment);
		const joins =
			open != null &&
			!trailing &&
			comment.type === "Line" &&
			open.type === "Line" &&
			comment.loc.start.line === open.end.loc.end.line + 1;
		if (joins) {
			open.end = comment;
			continue;
		}
		open = { type: comment.type, start: comment, end: comment };
		blocks.push(open);
	}
	return blocks;
}

export const noLongComments = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Keep a comment short enough to carry one non-obvious constraint; longer rationale belongs in docs/.",
		},
		schema: [
			{
				type: "object",
				additionalProperties: false,
				properties: { maxLines: { type: "integer", minimum: 1 } },
			},
		],
		messages: {
			tooLong:
				"This comment carries {{lineCount}} lines of prose; the ceiling is {{maxLines}}. Clarify the code so it needs less prose, or move the durable rationale into docs/ and link it. See docs/rules/engineering.md → Comments.",
		},
	},
	create(context) {
		const maxLines = context.options[0]?.maxLines ?? DEFAULT_MAX_LINES;
		return {
			Program() {
				for (const block of blocksOf(context.sourceCode)) {
					const lineCount = proseLines(context.sourceCode, block);
					if (lineCount <= maxLines) continue;
					context.report({
						data: { lineCount, maxLines },
						loc: { start: block.start.loc.start, end: block.end.loc.end },
						messageId: "tooLong",
					});
				}
			},
		};
	},
};
