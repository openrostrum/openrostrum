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
				"Disallow arbitrary hexadecimal Tailwind color utilities (e.g. bg-[#fff]); use a palette or @theme token utility.",
		},
		schema: [],
		messages: {
			rawColor:
				"Avoid an arbitrary hex color utility like `bg-[#fff]`; use a Tailwind palette or @theme token utility.",
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
