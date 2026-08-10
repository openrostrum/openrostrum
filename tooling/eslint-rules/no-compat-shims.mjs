// This is an application, not a library: every caller is in this repo, so
// there is no "backward" to be compatible with. Renames update all call sites
// in the same change; data-shape changes ship as forward migrations, never
// tolerant readers; old paths are deleted, not deprecated — git is the
// archive. Compatibility exists only at owner-decided external boundaries
// (see docs/rules/engineering.md → No legacy).
const COMPAT_COMMENT =
	/@deprecated|backwards?[- ]compat|kept for (old|compat|legacy)|for old (callers|clients|formats?)|supports? the old\b|\blegacy (path|format|behavio|support)|old format\b/i;
const COMPAT_NAME = /^(legacy|deprecated)|(Legacy|Deprecated)/;

export const noCompatShims = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Ban backward-compatibility shims: @deprecated markers, legacy/deprecated identifiers, kept-for-compat comments.",
		},
		schema: [],
		messages: {
			compatComment:
				'Backward-compatibility marker in a comment ("{{match}}"). Nothing outside this repo calls our internals: update every caller in this change, migrate data forward, and DELETE the old path — git is the archive. Owner-decided external boundaries are the only exception. See docs/rules/engineering.md → No legacy.',
			compatName:
				'Identifier "{{name}}" declares a legacy/deprecated thing. Don\'t keep two ways to do the same thing — replace the old one and update its callers in this change (the type-checker finds them). See docs/rules/engineering.md → No legacy.',
		},
	},
	create(context) {
		function checkName(idNode) {
			if (idNode?.type === "Identifier" && COMPAT_NAME.test(idNode.name)) {
				context.report({
					node: idNode,
					messageId: "compatName",
					data: { name: idNode.name },
				});
			}
		}
		return {
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					const match = COMPAT_COMMENT.exec(comment.value);
					if (match) {
						context.report({
							loc: comment.loc,
							messageId: "compatComment",
							data: { match: match[0] },
						});
					}
				}
			},
			VariableDeclarator(node) {
				checkName(node.id);
			},
			FunctionDeclaration(node) {
				checkName(node.id);
			},
			ClassDeclaration(node) {
				checkName(node.id);
			},
			TSTypeAliasDeclaration(node) {
				checkName(node.id);
			},
			TSInterfaceDeclaration(node) {
				checkName(node.id);
			},
		};
	},
};
