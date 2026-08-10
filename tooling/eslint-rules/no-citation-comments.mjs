// Comments must state the load-bearing constraint itself; citations of
// planning docs rot the moment those docs change and read as reviewer-talk
// (the mappings live in docs/eval-crosswalk.md and the GAP-REGISTER, never in
// code). See docs/rules/engineering.md → Comments.
const CITATION =
	/SCOPE\.md|SCOPE\s+P[0-2]|\bP[0-2]\s*#\d|GAP-REGISTER|eval[- ]kit|\b(CFP|ABS|SPK|CNT|AIA|EMB|CRM)-\d{2}\b/;

export const noCitationComments = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Code comments must not cite SCOPE tiers, eval-kit rubric IDs, or GAP-REGISTER rows — state the constraint directly.",
		},
		schema: [],
		messages: {
			citation:
				"Comment cites a planning doc ({{match}}). Delete the citation and state the load-bearing WHY directly — or delete the comment if nothing remains. See docs/rules/engineering.md → Comments.",
		},
	},
	create(context) {
		const sourceCode = context.sourceCode;
		return {
			Program() {
				for (const comment of sourceCode.getAllComments()) {
					const match = CITATION.exec(comment.value);
					if (match) {
						context.report({
							loc: comment.loc,
							messageId: "citation",
							data: { match: match[0] },
						});
					}
				}
			},
		};
	},
};
