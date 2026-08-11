import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * React Router's route-export scanner runs a headless Vite dev server (its
 * marker is the hardcoded `node_modules/.vite-child-compiler` cacheDir) that
 * inherits the cloudflare plugin, whose workerd-backed `ssr` environment
 * enables dep-optimizer discovery and sends HMR events over a WebSocket to
 * the workerd runner. That headless server never listens, so the WebSocket
 * never connects — and the optimizer never processes `optimizeDeps.include`
 * either (that only happens on listen), so include-pins cannot prevent
 * discovery there. When route files' bare imports (e.g. @dnd-kit/*) are
 * discovered mid-build, the optimizer re-bundles and fires a full-reload on
 * the hot channel: "AssertionError: The WebSocket is undefined", invalidating
 * the module graph so the SSR pass dies loading the server manifest. The
 * scanner only transforms route files to read their export names — it never
 * executes them — so the optimizer is pure overhead there: turn it off.
 */
const childCompilerNoSsrOptimizer: Plugin = {
	name: "openrostrum:child-compiler-no-ssr-optimizer",
	config: {
		// The cloudflare plugin's config hook sets `noDiscovery: false`; merge
		// after it so this wins.
		order: "post",
		handler(userConfig) {
			if (!userConfig.cacheDir?.includes(".vite-child-compiler")) return;
			return {
				environments: {
					ssr: { optimizeDeps: { noDiscovery: true, include: [] } },
				},
			};
		},
	},
};

export default defineConfig({
	// Pre-bundle the heavy client-only editor/drag deps with the initial
	// optimizer pass: discovering them lazily mid-session makes Vite mint a
	// second React chunk and the consumer crashes with "Cannot read properties
	// of null (reading 'useRef')" on first load.
	optimizeDeps: {
		include: [
			"@tiptap/react",
			"@tiptap/starter-kit",
			"@dnd-kit/core",
			"@dnd-kit/sortable",
			"@dnd-kit/utilities",
		],
	},
	plugins: [
		cloudflare({
			viteEnvironment: { name: "ssr" },
			// Workers AI is remote-only; local app verification must not require
			// Cloudflare authentication or spend against a live provider.
			remoteBindings: false,
		}),
		tailwindcss(),
		reactRouter(),
		tsconfigPaths(),
		childCompilerNoSsrOptimizer,
	],
});
