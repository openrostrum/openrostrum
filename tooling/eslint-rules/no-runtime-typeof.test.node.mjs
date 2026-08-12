import assert from "node:assert/strict";
import { test } from "node:test";
import { Linter, RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { noRuntimeTypeof } from "./no-runtime-typeof.mjs";

const ruleTester = new RuleTester({
	languageOptions: { parser: tseslint.parser },
});

const runtimeTypeof = [{ messageId: "runtimeTypeof" }];

// TYPE-level typeof is the whole reason this is a rule and not a
// no-restricted-syntax selector on `typeof`: `keyof typeof`, `: typeof X` and
// `typeof import()` are TSTypeQuery nodes and must never report — the codebase
// has hundreds of them and one false positive would sink the rule.
test("type-level typeof never reports", () => {
	ruleTester.run("no-runtime-typeof", noRuntimeTypeof, {
		valid: [
			"const STATUS = ['a'] as const; type S = (typeof STATUS)[number];",
			"const M = { a: 1 }; type K = keyof typeof M;",
			"declare const f: typeof import('./x');",
			"function g(a: typeof Number) { return a; }",
			"const M = { a: 1 }; const k = 'a' as keyof typeof M; const v = M[k];",
			"const x: unknown = 1; const s = String(x);",
		],
		invalid: [],
	});
});

// Every runtime form reports, whichever side the literal sits on and whether
// or not it is compared at all — a bare `typeof x` in a template or a
// `switch (typeof x)` is the same unparsed value, just spelled differently.
test("every runtime typeof form reports", () => {
	ruleTester.run("no-runtime-typeof", noRuntimeTypeof, {
		valid: [],
		invalid: [
			{
				code: "const x: unknown = 1; if (typeof x === 'string') {}",
				errors: runtimeTypeof,
			},
			{
				code: "const x: unknown = 1; if ('number' === typeof x) {}",
				errors: runtimeTypeof,
			},
			{
				code: "const x: unknown = 1; const b = typeof x !== 'object';",
				errors: runtimeTypeof,
			},
			{
				code: "const x: unknown = 1; const t = typeof x;",
				errors: runtimeTypeof,
			},
			{
				code: "const x: unknown = 1; switch (typeof x) { default: }",
				errors: runtimeTypeof,
			},
			{
				code: "const x: unknown = 1; const s = `${typeof x}`;",
				errors: runtimeTypeof,
			},
		],
	});
});

function messageFor(code) {
	const linter = new Linter();
	const [first] = linter.verify(code, {
		plugins: { local: { rules: { "no-runtime-typeof": noRuntimeTypeof } } },
		rules: { "local/no-runtime-typeof": "error" },
	});
	return first?.message ?? "";
}

// The remedy is the rule's actual product: "parse it" and "model it" are
// different fixes, and a message that named neither would push every site
// toward the same mechanical schema call.
test("the message names the remedy for the probed type", () => {
	assert.match(
		messageFor("if (typeof x === 'string') {}"),
		/Parse the value where it enters/,
	);
	assert.match(
		messageFor("if (typeof x === 'object') {}"),
		/typeof null === "object"/,
	);
	assert.match(
		messageFor("if (typeof x === 'function') {}"),
		/Model the callable in the type/,
	);
	assert.match(messageFor("if (typeof x === 'undefined') {}"), /=== undefined/);
	assert.match(
		messageFor("const t = typeof x;"),
		/Parse untrusted data where it enters/,
	);
});
