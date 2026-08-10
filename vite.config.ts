import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	// Pre-bundle Tiptap with the initial optimizer pass: discovering it lazily
	// mid-session makes Vite mint a second React chunk and the editor crashes
	// with "Cannot read properties of null (reading 'useRef')" on first load.
	optimizeDeps: { include: ["@tiptap/react", "@tiptap/starter-kit"] },
	plugins: [
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		tailwindcss(),
		reactRouter(),
		tsconfigPaths(),
	],
});
