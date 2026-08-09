function isErrorCheck(node) {
	return (
		node?.type === "BinaryExpression" &&
		node.operator === "instanceof" &&
		node.right.type === "Identifier" &&
		node.right.name === "Error"
	);
}

export const preferErrorNormalizer = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow inline Error ternary normalization in favor of the shared caught-error boundary.",
		},
		schema: [],
		messages: {
			inline:
				"Normalize caught values with errorMessage(), errorName(), or toError() instead of an inline instanceof Error ternary.",
		},
	},
	create(context) {
		return {
			ConditionalExpression(node) {
				if (isErrorCheck(node.test)) {
					context.report({
						messageId: "inline",
						node,
					});
				}
			},
		};
	},
};
