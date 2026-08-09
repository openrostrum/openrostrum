// A "for now / TODO / temporary" comment is a scope decision made by someone
// with no authority to make it, recorded nowhere an owner will see, defaulting
// to permanent. Deferrals go to the integration owner and become SCOPE rows;
// owner-approved unbuilt paths throw instead of silently degrading — the code
// itself carries no deferral marker (see docs/engineering.md → No shortcuts).
const DEFERRAL =
	/\b(TODO|FIXME|XXX)\b|\bhack(y|ish)?\b|for now\b|\btemporar(y|ily)\b|\bstopgap\b|\bband-aid\b|quick (fix|follow)|good enough for\b|for the demo\b|in a real (app|product|implementation)\b|(implement|handle|clean(ed)? up|improve|finish|fix( it)?|do (this|it)|revisit)\s+(this\s+)?later\b|\bfollow-?up (PR|task|change)\b/i;

export const noDeferralComments = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Ban deferral/shortcut markers in comments — deferrals escalate to the integration owner as SCOPE rows, never live in code.",
		},
		schema: [],
		messages: {
			deferral:
				'Deferral marker in a comment ("{{match}}"). Build it right, or raise it: a deferral is a scope decision for the integration owner (it becomes a SCOPE row) — then delete this marker; an approved unbuilt path throws, it never silently degrades. See docs/engineering.md → No shortcuts.',
		},
	},
	create(context) {
		return {
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					const match = DEFERRAL.exec(comment.value);
					if (match) {
						context.report({
							loc: comment.loc,
							messageId: "deferral",
							data: { match: match[0] },
						});
					}
				}
			},
		};
	},
};
