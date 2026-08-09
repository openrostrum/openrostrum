const genericConstructors = new Map([
	["Array", "Use Array.isArray(value) instead of value instanceof Array."],
	[
		"Boolean",
		"Parse the value at its boundary instead of checking a boxed primitive.",
	],
	["Function", "Model the callable type or parse it at the boundary."],
	[
		"Number",
		"Parse the value at its boundary instead of checking a boxed primitive.",
	],
	[
		"Object",
		"Parse the value with a schema instead of value instanceof Object.",
	],
	[
		"String",
		"Parse the value at its boundary instead of checking a boxed primitive.",
	],
]);

function isLocallyDefined(context, node) {
	let scope = context.sourceCode.getScope(node);
	while (scope) {
		const variable = scope.set.get(node.name);
		if (variable) {
			return variable.defs.length > 0;
		}
		scope = scope.upper;
	}
	return false;
}

export const noGenericInstanceof = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow generic instanceof checks that act as weak runtime shape validation.",
		},
		schema: [],
		messages: {
			generic: "{{message}}",
		},
	},
	create(context) {
		return {
			BinaryExpression(node) {
				if (
					node.operator !== "instanceof" ||
					node.right.type !== "Identifier"
				) {
					return;
				}
				const message = genericConstructors.get(node.right.name);
				if (message === undefined || isLocallyDefined(context, node.right)) {
					return;
				}
				context.report({
					data: { message },
					messageId: "generic",
					node,
				});
			},
		};
	},
};
