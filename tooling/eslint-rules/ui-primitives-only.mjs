// Routes compose ~/ui primitives; every visual decision (color, border,
// radius, shadow, typography) lives in app/ui + the @theme tokens, so a
// re-skin needs zero route diffs (docs/rules/engineering.md → Design system).
// Routes may only speak layout: flex/grid/gap/padding/margin/width/position.
const BANNED_ELEMENTS = new Set([
	"button",
	"input",
	"select",
	"textarea",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
]);

const SKIN_CLASS =
	/(?:^|[\s:])((?:bg|text|border|rounded|shadow|ring|divide|outline|fill|stroke|font|tracking|leading|decoration|from|via|to|animate|transition|duration|ease|delay)(?:-\S+)?|border|rounded|shadow|italic|underline|uppercase|lowercase|capitalize|transition)(?=\s|$)/;

function staticStrings(node) {
	if (node.type === "Literal") {
		return typeof node.value === "string" ? [node.value] : [];
	}
	if (node.type === "TemplateLiteral") {
		return [
			...node.quasis.map((q) => q.value.raw),
			...node.expressions.flatMap(staticStrings),
		];
	}
	if (node.type === "ConditionalExpression") {
		return [
			...staticStrings(node.consequent),
			...staticStrings(node.alternate),
		];
	}
	if (node.type === "LogicalExpression") {
		return staticStrings(node.right);
	}
	if (node.type === "BinaryExpression" && node.operator === "+") {
		return [...staticStrings(node.left), ...staticStrings(node.right)];
	}
	if (
		node.type === "ArrowFunctionExpression" &&
		node.body.type !== "BlockStatement"
	) {
		return staticStrings(node.body);
	}
	return [];
}

export const uiPrimitivesOnly = {
	meta: {
		type: "problem",
		docs: {
			description:
				"In route modules: ban raw interactive/table elements, skin className utilities, and inline style — compose ~/ui primitives instead.",
		},
		schema: [],
		messages: {
			rawElement:
				"Raw <{{name}}> in a route — compose the ~/ui primitive instead (Button, Input, Select, Table…). Need one that doesn't exist? Request it from the integration owner, like a schema column. See docs/rules/engineering.md → Design system.",
			skinClass:
				'Skin utility "{{match}}" in a route — visual decisions live in app/ui + the @theme tokens; routes speak layout only (flex/grid/gap/p-/m-/w-). Move the styling into a ~/ui primitive or variant. See docs/rules/engineering.md → Design system.',
			styleProp:
				"Inline style in a route — pass the data to a primitive that owns the styling (e.g. Chip's color prop). See docs/rules/engineering.md → Design system.",
		},
	},
	create(context) {
		return {
			JSXOpeningElement(node) {
				if (
					node.name.type === "JSXIdentifier" &&
					BANNED_ELEMENTS.has(node.name.name)
				) {
					context.report({
						node: node.name,
						messageId: "rawElement",
						data: { name: node.name.name },
					});
				}
			},
			JSXAttribute(node) {
				if (node.name.type !== "JSXIdentifier") return;
				if (node.name.name === "style") {
					context.report({ node, messageId: "styleProp" });
					return;
				}
				if (node.name.name !== "className" || node.value === null) return;
				const expr =
					node.value.type === "Literal"
						? node.value
						: node.value.type === "JSXExpressionContainer" &&
								node.value.expression.type !== "JSXEmptyExpression"
							? node.value.expression
							: null;
				if (expr === null) return;
				for (const value of staticStrings(expr)) {
					const match = SKIN_CLASS.exec(value);
					if (match) {
						context.report({
							node,
							messageId: "skinClass",
							data: { match: match[1] },
						});
						return;
					}
				}
			},
		};
	},
};
