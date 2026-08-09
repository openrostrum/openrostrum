// Every route that exports a `loader` OR `action` must authenticate, or opt out
// explicitly. Copied 50×, the one route that guards neither is an
// UNAUTHENTICATED READ/WRITE that still passes CI — and single-fetch makes a
// child `loader` reachable ALONE (`?_routes=`), so layout-loader auth does NOT
// cover children. We flag an exported loader/action unless an auth helper
// (requireUser/requireAdmin/requireRole/getUser) is actually CALLED inside that
// function's own body, or the file carries a `// @public` COMMENT (public
// surfaces: home, login, logout, 403, public CFP, public schedule).
const AUTH_HELPERS = new Set([
	"requireUser",
	"requireAdmin",
	"requireRole",
	"getUser",
]);
const DATA_FNS = new Set(["loader", "action"]);

function exportedDataFnName(node) {
	if (node.type === "FunctionDeclaration") {
		return node.id?.type === "Identifier" && DATA_FNS.has(node.id.name)
			? node.id.name
			: null;
	}
	if (node.type === "VariableDeclaration") {
		for (const d of node.declarations) {
			if (d.id.type === "Identifier" && DATA_FNS.has(d.id.name))
				return d.id.name;
		}
	}
	return null;
}

function calleeName(callee) {
	if (callee.type === "Identifier") return callee.name;
	if (
		callee.type === "MemberExpression" &&
		callee.property.type === "Identifier"
	) {
		return callee.property.name;
	}
	return null;
}

export const requireAuthInActions = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Require an auth check (or explicit // @public opt-out) in any route that exports a loader or action.",
		},
		schema: [],
		messages: {
			missingAuth:
				"This route's `{{fn}}` has no auth check. Single-fetch makes it reachable directly, so it must call requireUser/requireAdmin/requireRole (or add a `// @public` comment if the route is intentionally public).",
		},
	},
	create(context) {
		const sourceCode = context.sourceCode ?? context.getSourceCode();
		// node → { fn, authed }
		const dataFns = [];
		return {
			ExportNamedDeclaration(node) {
				if (!node.declaration) return;
				const fn = exportedDataFnName(node.declaration);
				if (fn) dataFns.push({ node: node.declaration, fn, authed: false });
			},
			CallExpression(node) {
				const name = calleeName(node.callee);
				if (!name || !AUTH_HELPERS.has(name)) return;
				for (const d of dataFns) {
					if (
						node.range[0] >= d.node.range[0] &&
						node.range[1] <= d.node.range[1]
					) {
						d.authed = true;
					}
				}
			},
			"Program:exit"() {
				if (dataFns.length === 0) return;
				const optedOut = sourceCode
					.getAllComments()
					.some((c) => /@public\b/.test(c.value));
				if (optedOut) return;
				for (const d of dataFns) {
					if (!d.authed) {
						context.report({
							node: d.node,
							messageId: "missingAuth",
							data: { fn: d.fn },
						});
					}
				}
			},
		};
	},
};
