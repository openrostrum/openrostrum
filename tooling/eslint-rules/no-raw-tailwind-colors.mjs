const rawColorUtility =
	/(?:^|\s)\S*(?:bg|border|fill|outline|ring|stroke|text)-\[#[\da-f]{3,8}\](?=\s|$)/iu;

function checkString(context, node, value) {
	if (rawColorUtility.test(value)) {
		context.report({
			messageId: "rawColor",
			node,
		});
	}
}

export const noRawTailwindColors = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Require semantic theme tokens instead of raw hexadecimal Tailwind color utilities.",
		},
		schema: [],
		messages: {
			rawColor:
				"Use a semantic @theme color token instead of a raw hexadecimal Tailwind color utility.",
		},
	},
	create(context) {
		return {
			Literal(node) {
				if (typeof node.value === "string") {
					checkString(context, node, node.value);
				}
			},
			TemplateElement(node) {
				checkString(context, node, node.value.raw);
			},
		};
	},
};
