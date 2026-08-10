// The theme is `color-scheme` on <html> (cookie-persisted, tri-state), so a
// `dark:` variant — which keys on the OS media query — desyncs the moment a
// visitor overrides the OS. All colors resolve via light-dark() instead.
// Prefix `(?:\S*:)?` covers stacked variants in both word form (hover:dark:)
// and bracket form ([&_svg]:dark:); light-dark( never matches — no colon.
const darkVariant = /(?:^|\s)(?:\S*:)?dark:\S+/u;

function checkString(context, node, value) {
	if (darkVariant.test(value)) {
		context.report({
			messageId: "darkVariant",
			node,
		});
	}
}

export const noDarkVariants = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow Tailwind `dark:` variants; they follow the OS media query and desync from the manual theme override — use light-dark() tokens or pairs.",
		},
		schema: [],
		messages: {
			darkVariant:
				"Never use a `dark:` variant — the theme is `color-scheme` on <html>, which a media query ignores; resolve the color with light-dark() instead.",
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
