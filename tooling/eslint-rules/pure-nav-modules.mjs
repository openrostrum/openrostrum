// app/nav/*.nav.ts files are eager-globbed into the CLIENT bundle by the admin
// shell. Any runtime import there (db, schema, ports) drags server code into
// every admin page's client JS, so nav modules stay pure data: only
// `import type` plus the registry's NavItem.
export const pureNavModules = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Nav modules (app/nav/*.nav.ts) must stay pure data: type-only imports from ./registry, nothing else.",
		},
		schema: [],
		messages: {
			impureImport:
				'Nav modules are bundled client-side — no runtime imports allowed here. Use `import type { NavItem } from "./registry"` and pure data only.',
		},
	},
	create(context) {
		return {
			ImportDeclaration(node) {
				// Allowed: `import type ... from "./registry"` (erased at compile time).
				if (node.importKind === "type" && node.source.value === "./registry") {
					return;
				}
				context.report({ node, messageId: "impureImport" });
			},
		};
	},
};
