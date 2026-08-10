// The app stylesheet is Tailwind configuration plus document ground — never a
// second component-styling system (docs/rules/engineering.md → Design system).
// Ported from cloudflare-agent-exercise (skewtrace/global-css-only).
import stylelint from "stylelint";

const ruleName = "openrostrum/global-css-only";
const allowedSelectors = new Set([":root", "body", "html"]);
const allowedAtRules = new Set([
	"font-face",
	"import",
	"keyframes",
	"source",
	"theme",
]);

const messages = stylelint.utils.ruleMessages(ruleName, {
	atRule: (name) =>
		`Unexpected @${name}. Component styling belongs in app/ui via Tailwind utilities; global CSS accepts only imports, @source, @theme tokens, @font-face, and @keyframes. See docs/rules/engineering.md → Design system.`,
	import: (value) =>
		`Unexpected CSS import ${value}. The global entrypoint may import only Tailwind.`,
	selector: (selector) =>
		`Unexpected selector "${selector}". Component styling belongs in app/ui via Tailwind utilities; only :root, html, body, and keyframe selectors belong in global CSS. See docs/rules/engineering.md → Design system.`,
});

function isKeyframeSelector(rule) {
	let parent = rule.parent;
	while (parent !== undefined) {
		if (parent.type === "atrule" && parent.name.toLowerCase() === "keyframes") {
			return true;
		}
		parent = parent.parent;
	}
	return false;
}

function isAllowedSelectorList(selector) {
	return selector.split(",").every((part) => allowedSelectors.has(part.trim()));
}

const ruleFunction = (primary) => (root, result) => {
	const valid = stylelint.utils.validateOptions(result, ruleName, {
		actual: primary,
		possible: [true],
	});
	if (!valid) return;

	root.walkAtRules((atRule) => {
		const name = atRule.name.toLowerCase();
		if (!allowedAtRules.has(name)) {
			stylelint.utils.report({
				message: messages.atRule(name),
				node: atRule,
				result,
				ruleName,
			});
			return;
		}
		if (
			name === "import" &&
			!atRule.params.trim().startsWith('"tailwindcss"')
		) {
			stylelint.utils.report({
				message: messages.import(atRule.params),
				node: atRule,
				result,
				ruleName,
			});
		}
	});

	root.walkRules((rule) => {
		if (isKeyframeSelector(rule) || isAllowedSelectorList(rule.selector)) {
			return;
		}
		stylelint.utils.report({
			message: messages.selector(rule.selector),
			node: rule,
			result,
			ruleName,
		});
	});
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;

export const globalCssOnly = stylelint.createPlugin(ruleName, ruleFunction);
export default globalCssOnly;
