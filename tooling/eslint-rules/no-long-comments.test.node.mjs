import assert from "node:assert/strict";
import { test } from "node:test";
import { Linter, RuleTester } from "eslint";
import { noLongComments } from "./no-long-comments.mjs";

const ruleTester = new RuleTester();
const tooLong = [{ messageId: "tooLong" }];

const four = "// one\n// two\n// three\n// four\nconst a = 1;";
const five = "// one\n// two\n// three\n// four\n// five\nconst a = 1;";

// The repo writes its rationale as runs of `//` lines (commit 622f882 trimmed
// exactly such a run to the ceiling by hand), so a run is ONE comment. Counting
// per line would leave the ceiling unenforceable against the dominant style.
test("a run of line comments counts as one comment", () => {
	ruleTester.run("no-long-comments", noLongComments, {
		valid: [four, "/* one\n two\n three\n four */\nconst a = 1;"],
		invalid: [
			{ code: five, errors: tooLong },
			{
				code: "/* one\n two\n three\n four\n five */\nconst a = 1;",
				errors: tooLong,
			},
		],
	});
});

// A blank line or a statement between comments starts a new block: two short
// comments on either side of code are two comments, not one long one.
test("code or a blank line breaks the run", () => {
	ruleTester.run("no-long-comments", noLongComments, {
		valid: [
			"// one\n// two\n// three\nconst a = 1;\n// four\n// five\n// six\nconst b = 2;",
			"// one\n// two\n\n// three\n// four\nconst a = 1;",
			"const a = 1; // trailing\n// one\n// two\n// three\nconst b = 2;",
		],
		invalid: [],
	});
});

// The delimiters carry no words, so the same rationale gets the same budget
// whichever way it is spelled — otherwise the rule would be measuring the
// comment's punctuation rather than its length.
test("a bare /** or */ line is not a line of prose", () => {
	const prose = ["one", "two", "three", "four"];
	const jsdoc = (lines) =>
		`/**\n${lines.map((l) => ` * ${l}`).join("\n")}\n */\nconst a = 1;`;
	ruleTester.run("no-long-comments", noLongComments, {
		valid: [jsdoc(prose), "/** one */\nconst a = 1;"],
		invalid: [
			{ code: jsdoc([...prose, "five"]), errors: tooLong },
			// A blank `*` line IS charged: two short paragraphs are still an essay.
			{ code: jsdoc(["one", "two", "", "three", "four"]), errors: tooLong },
		],
	});
});

// The ceiling is configurable so a future carve-out is a config decision with a
// number in it, not an inline suppression.
test("maxLines is configurable", () => {
	ruleTester.run("no-long-comments", noLongComments, {
		valid: [{ code: five, options: [{ maxLines: 5 }] }],
		invalid: [{ code: four, options: [{ maxLines: 3 }], errors: tooLong }],
	});
});

// The count in the message is what a reader trims against, so it must be the
// span of the whole block, not of its last line.
test("the message reports the block's real line span", () => {
	const linter = new Linter();
	const [first] = linter.verify(five, {
		plugins: { local: { rules: { "no-long-comments": noLongComments } } },
		rules: { "local/no-long-comments": "error" },
	});
	assert.match(first.message, /carries 5 lines of prose; the ceiling is 4/);
	assert.equal(first.line, 1);
	assert.equal(first.endLine, 5);
});
