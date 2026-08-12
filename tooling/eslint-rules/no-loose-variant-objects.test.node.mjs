import { test } from "node:test";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { noLooseVariantObjects } from "./no-loose-variant-objects.mjs";

const ruleTester = new RuleTester({
	languageOptions: { parser: tseslint.parser },
});

const looseVariant = [{ messageId: "looseVariant" }];

// The shape the rule exists for: the enum picks the branch and each optional
// belongs to only some branches, so a caller cannot tell which fields it may
// read. One optional next to an enum is ordinary; two is the tell.
test("an enum beside multiple optional siblings reports", () => {
	ruleTester.run("no-loose-variant-objects", noLooseVariantObjects, {
		valid: [
			"z.object({ type: z.enum(['a','b']), label: z.string(), note: z.string().optional() })",
			"z.object({ a: z.string().optional(), b: z.string().optional(), c: z.string() })",
			"z.discriminatedUnion('type', [A, B])",
		],
		invalid: [
			{
				code: "z.object({ type: z.enum(['a','b']), min: z.string().optional(), max: z.string().optional() })",
				errors: looseVariant,
			},
			{
				code: "z.strictObject({ type: z.union([z.literal('a'), z.literal('b')]), x: z.string().optional(), y: z.string().nullish() })",
				errors: looseVariant,
			},
		],
	});
});

// `z.coerce.number()` roots on a member expression rather than on `z` itself;
// missing that made every coerced optional invisible and hid the one real
// loose variant in this repo.
test("coerced fields are still fields", () => {
	ruleTester.run("no-loose-variant-objects", noLooseVariantObjects, {
		valid: [],
		invalid: [
			{
				code: "z.object({ type: z.enum(['a','b']), min: z.coerce.number().int().optional(), max: z.coerce.number().int().optional() })",
				errors: looseVariant,
			},
		],
	});
});

// TypeBox wraps optionality instead of chaining it, and both dialects ship
// here — a rule that only read Zod would police half the schemas.
test("TypeBox schemas are read too", () => {
	ruleTester.run("no-loose-variant-objects", noLooseVariantObjects, {
		valid: [
			"Type.Object({ kind: Type.Enum(K), only: Type.Optional(Type.String()) })",
		],
		invalid: [
			{
				code: "Type.Object({ kind: Type.Enum(K), a: Type.Optional(Type.String()), b: Type.Optional(Type.Number()) })",
				errors: looseVariant,
			},
			{
				code: "Type.Object({ kind: Type.Union([Type.Literal('a'), Type.Literal('b')]), a: Type.Optional(Type.String()), b: Type.Optional(Type.Number()) })",
				errors: looseVariant,
			},
		],
	});
});

// A lone literal is the tag of a union that already exists, and an optional
// nested inside an array element belongs to the element — flagging either
// would flag the fix rather than the defect.
test("the correct patterns do not report", () => {
	ruleTester.run("no-loose-variant-objects", noLooseVariantObjects, {
		valid: [
			"z.object({ type: z.literal('rating'), min: z.number().optional(), max: z.number().optional() })",
			"z.object({ type: z.enum(['a','b']), rows: z.array(z.object({ x: z.string().optional(), y: z.string().optional() })) })",
		],
		invalid: [],
	});
});
