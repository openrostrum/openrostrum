// Shape belongs to the boundary, not to a branch deep in the code: a runtime
// `typeof` says the program does not know what it is holding. The remedy
// depends on why — parse once at the boundary, or model the variant — so each
// probed type names its own. See docs/rules/engineering.md → Shape at the boundary.
const REMEDIES = new Map([
	[
		"string",
		"Parse the value where it enters the program (a schema, or a typed accessor over FormData/JSON) so callers are handed a string.",
	],
	[
		"number",
		"Parse the value at its boundary — typeof cannot tell you it is finite or in range, so the check is weaker than it looks.",
	],
	[
		"boolean",
		"Parse the value at its boundary instead of re-probing the flag downstream.",
	],
	["bigint", "Parse the value at its boundary."],
	[
		"object",
		'Parse the value with a schema — typeof cannot separate null, arrays and objects (typeof null === "object").',
	],
	[
		"function",
		"Model the callable in the type: a discriminated union, an overload, or a narrower parameter type.",
	],
	[
		"undefined",
		"Compare with `=== undefined` when the binding exists, or model the absence as an optional field on a parsed type.",
	],
	["symbol", "Model the variant in the type instead of probing it."],
]);

const GENERIC_REMEDY =
	"Parse untrusted data where it enters the program, or model the variant in TypeScript, so the runtime shape question disappears.";

// `typeof x === "string"` and `"string" === typeof x` both name the probed
// type, so the report can name its remedy. Anything else — a bare `typeof x`
// in a template, `switch (typeof x)` — gets the generic remedy.
function comparedLiteral(node) {
	const parent = node.parent;
	if (parent?.type !== "BinaryExpression") return null;
	const other = parent.left === node ? parent.right : parent.left;
	return other?.type === "Literal" && typeof other.value === "string"
		? other.value
		: null;
}

export const noRuntimeTypeof = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Ban runtime typeof checks — they hand-roll the shape validation that belongs at the boundary.",
		},
		schema: [],
		messages: {
			runtimeTypeof:
				"Runtime `typeof` check. {{remedy}} See docs/rules/engineering.md → Shape at the boundary.",
		},
	},
	create(context) {
		return {
			// TSTypeQuery (`keyof typeof X`, `: typeof import(...)`) is a distinct
			// node type, so type-level typeof is out of reach of this visitor.
			UnaryExpression(node) {
				if (node.operator !== "typeof") return;
				const literal = comparedLiteral(node);
				context.report({
					data: { remedy: REMEDIES.get(literal) ?? GENERIC_REMEDY },
					messageId: "runtimeTypeof",
					node: node.parent?.type === "BinaryExpression" ? node.parent : node,
				});
			},
		};
	},
};
