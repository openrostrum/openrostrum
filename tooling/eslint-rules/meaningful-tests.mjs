// The mechanical subset of the test rule (docs/engineering.md → Tests). A test
// that asserts nothing, only asserts mock calls, snapshots to a file, checks an
// imported constant against its own literal, or mocks a sibling module can
// never catch a regression — it re-proves the implementation to itself.
const CALL_MATCHERS = new Set([
	"toHaveBeenCalled",
	"toHaveBeenCalledWith",
	"toHaveBeenCalledTimes",
	"toHaveBeenCalledOnce",
	"toHaveBeenLastCalledWith",
	"toHaveBeenNthCalledWith",
	"toBeCalled",
	"toBeCalledWith",
	"toBeCalledTimes",
]);
const LITERAL_MATCHERS = new Set(["toContain", "toBe", "toEqual", "toMatch"]);
const TEST_FNS = new Set(["it", "test"]);

function isTestCall(node) {
	const c = node.callee;
	if (c.type === "Identifier" && TEST_FNS.has(c.name)) return true;
	return (
		c.type === "MemberExpression" &&
		c.object.type === "Identifier" &&
		TEST_FNS.has(c.object.name)
	);
}

/** For `expect(x).not.foo()` chains: returns { matcher, arg } or null. */
function expectChain(node) {
	if (node.callee.type !== "MemberExpression") return null;
	const matcher = node.callee.property;
	if (matcher.type !== "Identifier") return null;
	let obj = node.callee.object;
	while (obj.type === "MemberExpression") obj = obj.object;
	if (
		obj.type === "CallExpression" &&
		obj.callee.type === "Identifier" &&
		obj.callee.name === "expect"
	) {
		return { matcher: matcher.name, expectArg: obj.arguments[0] };
	}
	return null;
}

function isImportedIdentifier(node, scope) {
	if (!node || node.type !== "Identifier") return false;
	let s = scope;
	while (s) {
		const variable = s.variables.find((v) => v.name === node.name);
		if (variable) return variable.defs.some((d) => d.type === "ImportBinding");
		s = s.upper;
	}
	return false;
}

export const meaningfulTests = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Ban mechanically-detectable proof-of-work tests: zero assertions, mock-call-only assertions, file snapshots, imported-literal assertions, sibling-module mocks.",
		},
		schema: [],
		messages: {
			noAssertions:
				"Test has no expect() — it can never fail, so it proves nothing. Assert an observable outcome (return value, thrown error, response, DB state). See docs/engineering.md → Tests.",
			callAssertionsOnly:
				"Every assertion here is a mock-call check — that verifies wiring, not behavior, and passes while the behavior is broken. Add an outcome assertion; call checks may only corroborate it. See docs/engineering.md → Tests.",
			externalSnapshot:
				"File snapshots are banned — they rubber-stamp whatever the code produced. Use an explicit assertion, or toMatchInlineSnapshot only where the full wire shape IS the contract. See docs/engineering.md → Tests.",
			importedLiteral:
				"This asserts an imported constant contains its own source literal — it fires on every deliberate edit and catches nothing. Test behavior (shape, leak, budget invariants), not copy. See docs/engineering.md → Tests.",
			siblingMock:
				"vi.mock of a local module fakes the thing you should be testing. Mock only process boundaries (providers, third-party SDKs, the clock); use the real module or promote to an integration test against real D1. See docs/engineering.md → Tests.",
		},
	},
	create(context) {
		const testStack = [];
		return {
			CallExpression(node) {
				if (isTestCall(node)) {
					testStack.push({ node, expects: 0, nonCallExpects: 0 });
					return;
				}
				if (
					node.callee.type === "MemberExpression" &&
					node.callee.object.type === "Identifier" &&
					node.callee.object.name === "vi" &&
					node.callee.property.type === "Identifier" &&
					node.callee.property.name === "mock"
				) {
					const spec = node.arguments[0];
					if (
						spec?.type === "Literal" &&
						typeof spec.value === "string" &&
						(spec.value.startsWith(".") || spec.value.startsWith("~"))
					) {
						context.report({ node, messageId: "siblingMock" });
					}
					return;
				}
				const chain = expectChain(node);
				if (!chain) return;
				const current = testStack[testStack.length - 1];
				if (current) {
					current.expects += 1;
					if (!CALL_MATCHERS.has(chain.matcher)) current.nonCallExpects += 1;
				}
				if (
					chain.matcher === "toMatchSnapshot" ||
					chain.matcher === "toMatchFileSnapshot"
				) {
					context.report({ node, messageId: "externalSnapshot" });
				}
				if (
					LITERAL_MATCHERS.has(chain.matcher) &&
					isImportedIdentifier(
						chain.expectArg,
						context.sourceCode.getScope(node),
					) &&
					node.arguments[0]?.type === "Literal" &&
					typeof node.arguments[0].value === "string"
				) {
					context.report({ node, messageId: "importedLiteral" });
				}
			},
			"CallExpression:exit"(node) {
				const current = testStack[testStack.length - 1];
				if (!current || current.node !== node) return;
				testStack.pop();
				if (current.expects === 0) {
					context.report({ node, messageId: "noAssertions" });
				} else if (current.nonCallExpects === 0) {
					context.report({ node, messageId: "callAssertionsOnly" });
				}
			},
		};
	},
};
