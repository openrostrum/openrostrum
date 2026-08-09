const MAX_INLINE_UTILITIES = 20;
const COMPOSITION_FUNCTIONS = new Set(["cn", "clsx", "twMerge"]);

function unwrapExpression(node) {
	if (
		node.type === "ChainExpression" ||
		node.type === "TSAsExpression" ||
		node.type === "TSInstantiationExpression" ||
		node.type === "TSNonNullExpression" ||
		node.type === "TSSatisfiesExpression" ||
		node.type === "TSTypeAssertion"
	) {
		return unwrapExpression(node.expression);
	}

	return node;
}

function isCompositionCall(node) {
	const expression = unwrapExpression(node);

	return (
		expression.type === "CallExpression" &&
		expression.callee.type === "Identifier" &&
		COMPOSITION_FUNCTIONS.has(expression.callee.name)
	);
}

function countUtilities(value) {
	let count = 0;
	let escaped = false;
	let quote = null;
	const delimiters = [];
	let insideUtility = false;

	for (const character of value) {
		if (escaped) {
			escaped = false;
			insideUtility = true;
			continue;
		}

		if (character === "\\") {
			escaped = true;
			insideUtility = true;
			continue;
		}

		if (quote !== null) {
			if (character === quote) {
				quote = null;
			}
			insideUtility = true;
			continue;
		}

		if (character === "'" || character === '"') {
			quote = character;
			insideUtility = true;
			continue;
		}

		if (character === "[" || character === "(" || character === "{") {
			delimiters.push(character);
			insideUtility = true;
			continue;
		}

		if (character === "]" || character === ")" || character === "}") {
			delimiters.pop();
			insideUtility = true;
			continue;
		}

		if (/\s/u.test(character) && delimiters.length === 0) {
			if (insideUtility) {
				count += 1;
				insideUtility = false;
			}
			continue;
		}

		insideUtility = true;
	}

	return count + Number(insideUtility);
}

function collectStaticFragments(node) {
	const expression = unwrapExpression(node);

	if (expression.type === "Literal") {
		return typeof expression.value === "string"
			? [{ node: expression, value: expression.value }]
			: [];
	}

	if (expression.type === "TemplateLiteral") {
		return [
			...expression.quasis.map((quasi) => ({
				node: quasi,
				value: quasi.value.raw,
			})),
			...expression.expressions.flatMap((item) => collectStaticFragments(item)),
		];
	}

	if (expression.type === "ConditionalExpression") {
		return [
			...collectStaticFragments(expression.consequent),
			...collectStaticFragments(expression.alternate),
		];
	}

	if (expression.type === "LogicalExpression") {
		return collectStaticFragments(expression.right);
	}

	if (expression.type === "BinaryExpression" && expression.operator === "+") {
		return [
			...collectStaticFragments(expression.left),
			...collectStaticFragments(expression.right),
		];
	}

	if (expression.type === "ArrayExpression") {
		return expression.elements.flatMap((element) =>
			element === null || element.type === "SpreadElement"
				? []
				: collectStaticFragments(element),
		);
	}

	if (expression.type === "SequenceExpression") {
		const lastExpression = expression.expressions.at(-1);
		return lastExpression === undefined
			? []
			: collectStaticFragments(lastExpression);
	}

	return [];
}

function collectObjectGroups(node) {
	return node.properties.flatMap((property) => {
		if (property.type === "SpreadElement" || property.computed) {
			return [];
		}

		if (property.key.type === "Identifier") {
			return [
				{
					fragments: [{ node: property.key, value: property.key.name }],
					node: property,
				},
			];
		}

		if (
			property.key.type === "Literal" &&
			typeof property.key.value === "string"
		) {
			return [
				{
					fragments: [{ node: property.key, value: property.key.value }],
					node: property,
				},
			];
		}

		return [];
	});
}

function collectCompositionGroups(node) {
	const expression = unwrapExpression(node);

	if (isCompositionCall(expression)) {
		return expression.arguments.flatMap((argument) =>
			argument.type === "SpreadElement"
				? []
				: collectCompositionGroups(argument),
		);
	}

	if (expression.type === "ObjectExpression") {
		return collectObjectGroups(expression);
	}

	return [
		{
			fragments: collectStaticFragments(expression),
			node: expression,
		},
	];
}

function countFragments(fragments) {
	return fragments.reduce(
		(total, fragment) => total + countUtilities(fragment.value),
		0,
	);
}

function classNameExpression(attribute) {
	if (attribute.value === null) {
		return null;
	}

	if (attribute.value.type === "Literal") {
		return attribute.value;
	}

	if (
		attribute.value.type === "JSXExpressionContainer" &&
		attribute.value.expression.type !== "JSXEmptyExpression"
	) {
		return attribute.value.expression;
	}

	return null;
}

export const structuredTailwindClassname = {
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Require complex Tailwind className values to be composed from bounded, named groups.",
		},
		schema: [],
		messages: {
			oversizedGroup:
				"This class group contains {{count}} utilities; the maximum is {{maximum}}. Split it into named groups by styling concern.",
			unstructured:
				"Inline className contains {{count}} utilities; the maximum is {{maximum}}. Compose named class groups or simplify the element structure.",
		},
	},
	create(context) {
		return {
			JSXAttribute(node) {
				if (
					node.name.type !== "JSXIdentifier" ||
					node.name.name !== "className"
				) {
					return;
				}

				const expression = classNameExpression(node);
				if (expression === null) {
					return;
				}

				if (isCompositionCall(expression)) {
					for (const group of collectCompositionGroups(expression)) {
						const count = countFragments(group.fragments);
						if (count > MAX_INLINE_UTILITIES) {
							context.report({
								data: {
									count,
									maximum: MAX_INLINE_UTILITIES,
								},
								messageId: "oversizedGroup",
								node: group.node,
							});
						}
					}
					return;
				}

				const count = countFragments(collectStaticFragments(expression));
				if (count > MAX_INLINE_UTILITIES) {
					context.report({
						data: {
							count,
							maximum: MAX_INLINE_UTILITIES,
						},
						messageId: "unstructured",
						node,
					});
				}
			},
		};
	},
};
