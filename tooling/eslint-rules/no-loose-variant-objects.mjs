// An object schema carrying an enum next to a pile of optional siblings is
// usually two or three shapes wearing one coat: the enum picks the branch, and
// each optional belongs to only some branches, so nothing tells a caller which
// fields it may read. See docs/rules/engineering.md → Shape at the boundary.
const MIN_OPTIONAL_SIBLINGS = 2;

const ZOD_OBJECT_FACTORIES = new Set(["object", "strictObject", "looseObject"]);

function isCallOn(node, objectName, propertyNames) {
	return (
		node?.type === "CallExpression" &&
		node.callee.type === "MemberExpression" &&
		node.callee.object.type === "Identifier" &&
		node.callee.object.name === objectName &&
		propertyNames.has(node.callee.property.name)
	);
}

// `z.coerce.number()` roots on a member expression, not on `z` directly.
function rootName(node) {
	let current = node;
	while (current.type === "MemberExpression") current = current.object;
	return current.type === "Identifier" ? current.name : null;
}

// Walk the outer chain only — arguments are not descended into, so the
// `.optional()` inside `z.array(z.string().optional())` is not a top-level
// optional. `z.enum([...]).optional()` yields `["enum", "optional"]`.
function readZodChain(node) {
	const methods = [];
	let current = node;
	let variantArgs = null;

	while (
		current.type === "CallExpression" &&
		current.callee.type === "MemberExpression"
	) {
		const method = current.callee.property.name;
		methods.unshift(method);
		if (method === "enum" || method === "union") {
			variantArgs = current.arguments;
		}
		current = current.callee.object;
	}

	return { base: rootName(current), methods, variantArgs };
}

function isUnionOfLiterals(args, isLiteralCall) {
	return (
		args?.[0]?.type === "ArrayExpression" &&
		args[0].elements.some((element) => isLiteralCall(element))
	);
}

function classifyZodField(value) {
	const { base, methods, variantArgs } = readZodChain(value);
	if (base !== "z" || methods.length === 0) return null;

	const head = methods[0];
	const isEnum =
		head === "enum" ||
		(head === "union" &&
			isUnionOfLiterals(variantArgs, (element) =>
				isCallOn(element, "z", new Set(["literal"])),
			));
	if (isEnum) return "enum";

	return methods.includes("optional") || methods.includes("nullish")
		? "optional"
		: null;
}

// A lone `z.literal()` / `Type.Literal()` field is NOT an enum: that is the tag
// of a union that already exists, and flagging it would flag the fix.
function isTypeBoxEnum(value) {
	if (isCallOn(value, "Type", new Set(["Enum"]))) return true;
	return (
		isCallOn(value, "Type", new Set(["Union"])) &&
		isUnionOfLiterals(value.arguments, (element) =>
			isCallOn(element, "Type", new Set(["Literal"])),
		)
	);
}

function classifyTypeBoxField(value) {
	if (isCallOn(value, "Type", new Set(["Optional"]))) {
		// An optional enum still picks the branch, same as `z.enum([]).optional()`.
		return isTypeBoxEnum(value.arguments[0]) ? "enum" : "optional";
	}
	return isTypeBoxEnum(value) ? "enum" : null;
}

function fieldName(property) {
	if (property.key.type === "Identifier") return property.key.name;
	if (property.key.type === "Literal") return String(property.key.value);
	return null;
}

// Zod chains optionality onto the field (`z.string().optional()`); TypeBox
// wraps it (`Type.Optional(...)`). Both dialects ship in this repo.
function schemaShape(node) {
	if (
		isCallOn(node, "z", ZOD_OBJECT_FACTORIES) &&
		node.arguments[0]?.type === "ObjectExpression"
	) {
		return {
			properties: node.arguments[0].properties,
			classify: classifyZodField,
		};
	}
	if (
		isCallOn(node, "Type", new Set(["Object"])) &&
		node.arguments[0]?.type === "ObjectExpression"
	) {
		return {
			properties: node.arguments[0].properties,
			classify: classifyTypeBoxField,
		};
	}
	return null;
}

export const noLooseVariantObjects = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Flag object schemas that pair an enum discriminant with multiple optional siblings; model the variants as a discriminated union instead.",
		},
		schema: [],
		messages: {
			looseVariant:
				"Loose variant schema: enum field(s) {{enums}} alongside optional sibling field(s) {{optionals}}. If this value has more than one shape, model the shapes as a discriminated union (z.discriminatedUnion / Type.Union of tagged objects) so each branch names the fields it carries — an optional field should mean absent-in-this-shape, not belongs-to-another-shape. See docs/rules/engineering.md → Shape at the boundary.",
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				const shape = schemaShape(node);
				if (!shape) return;

				const enums = [];
				const optionals = [];
				for (const property of shape.properties) {
					if (property.type !== "Property") continue;
					const name = fieldName(property);
					if (!name) continue;
					const kind = shape.classify(property.value);
					if (kind === "enum") enums.push(name);
					else if (kind === "optional") optionals.push(name);
				}

				if (enums.length >= 1 && optionals.length >= MIN_OPTIONAL_SIBLINGS) {
					context.report({
						data: {
							enums: enums.join(", "),
							optionals: optionals.join(", "),
						},
						messageId: "looseVariant",
						node: node.callee,
					});
				}
			},
		};
	},
};
