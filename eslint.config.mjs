import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import { openrostrumPlugin } from "./tooling/eslint-rules/index.mjs";

// Lint layer. Formatting is owned by Biome (its linter is disabled) — see
// docs/rules/tech-stack.md. Type errors are owned by `tsc` (pnpm typecheck), so we run
// typescript-eslint's non-type-checked preset here (fast, no projectService).

const APP = ["app/**/*.{ts,tsx}", "workers/**/*.ts", "test/**/*.ts"];
const REACT = ["app/**/*.tsx"];

export default [
	{
		ignores: [
			"build/**",
			".react-router/**",
			".wrangler/**",
			".claude/**", // nested git worktrees lint themselves, never from the parent

			"drizzle/**",
			"docs/**",
			".agents/**",
			"tooling/**",
			"scripts/**",
			"node_modules/**",
			"worker-configuration.d.ts",
			"*.config.{js,mjs,ts}",
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,

	// App + workers + tests: project seams + generic red-flag rules.
	{
		files: APP,
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		plugins: { openrostrum: openrostrumPlugin },
		rules: {
			"openrostrum/no-citation-comments": "error",
			"openrostrum/no-compat-shims": "error",
			"openrostrum/no-deferral-comments": "error",
			"openrostrum/no-generic-instanceof": "error",
			"openrostrum/no-long-comments": "error",
			"openrostrum/no-loose-variant-objects": "error",
			"openrostrum/no-runtime-typeof": "error",
			"openrostrum/prefer-error-normalizer": "error",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
			// Seam: React Router v7 imports only (was scripts/check-conventions.sh).
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "react-router-dom",
							message:
								"Import from 'react-router' (v7 framework mode), not react-router-dom.",
						},
						{
							name: "react-router",
							importNames: ["json", "defer"],
							message:
								"Return plain objects from loaders/actions — json()/defer() are removed in RR7.",
						},
					],
					patterns: [
						{
							group: ["@remix-run/*"],
							message: "Import from 'react-router', not @remix-run/*.",
						},
						{
							// Seam: ONE shared rich-text editor (docs/rules/harness.md).
							// Four parallel lanes each grew a Tiptap fork before the
							// consolidation; this keeps the fifth from ever compiling.
							group: ["@tiptap/*"],
							message:
								"Compose <RichText/> from '~/ui/rich-text' — never a second Tiptap editor (docs/rules/harness.md: one shared rich-text editor).",
						},
					],
				},
			],
			// Seam: D1 has no interactive transactions — use db.batch().
			"no-restricted-syntax": [
				"error",
				{
					selector:
						"CallExpression > MemberExpression[property.name='transaction']",
					message: "D1 has no interactive transactions — use db.batch().",
				},
			],
		},
	},

	// A third party that answers with an error is the outage shape every adapter
	// here already handles; one that accepts the connection and then says nothing
	// is the one that gets forgotten, and then the only limit is whatever the
	// platform imposes. Matching on the options object exempts a transport that
	// forwards its arguments and catches the mistake this exists for: a fetch
	// written with a method, headers, and a body but no deadline.
	{
		files: ["app/ports/**/*.ts"],
		rules: {
			"no-restricted-syntax": [
				"error",
				{
					selector:
						"CallExpression:matches([callee.name='fetch'], [callee.property.name='fetch']) > ObjectExpression:not(:has(> Property[key.name='signal']))",
					message:
						"An outbound fetch needs a deadline — pass signal: AbortSignal.timeout(ms). See docs/rules/tech-stack.md → Timeouts.",
				},
			],
		},
	},

	// React / hooks / a11y — only where components live.
	{ ...react.configs.flat.recommended, files: REACT },
	{ ...reactHooks.configs.flat["recommended-latest"], files: REACT },
	{ ...jsxA11y.flatConfigs.recommended, files: REACT },
	{
		files: REACT,
		plugins: { openrostrum: openrostrumPlugin },
		settings: { react: { version: "19.2.1" } },
		rules: {
			"openrostrum/no-dark-variants": "error",
			"openrostrum/no-raw-tailwind-colors": "error",
			"openrostrum/structured-tailwind-classname": "error",
			"react/react-in-jsx-scope": "off", // React 19 / RR7 — no import needed
			"react/prop-types": "off", // TypeScript handles this
		},
	},

	// Route modules (incl. .ts resource/API routes): an exported `action` must
	// authenticate (or opt out with a // @public comment), and UI is composed
	// from ~/ui primitives — no raw elements, skin classes, or inline style.
	// app/settings hosts route-shared form components (flatRoutes forbids
	// non-route files in app/routes/), so it carries the same UI discipline.
	{
		files: ["app/routes/**/*.{ts,tsx}", "app/settings/**/*.{ts,tsx}"],
		plugins: { openrostrum: openrostrumPlugin },
		rules: {
			"openrostrum/require-auth-in-actions": "error",
			"openrostrum/ui-primitives-only": "error",
		},
	},

	// Shared route views: when thin routes delegate their page JSX to app/lib,
	// the design-system contract follows the JSX, not the file location.
	{
		files: ["app/lib/**/*.tsx"],
		plugins: { openrostrum: openrostrumPlugin },
		rules: { "openrostrum/ui-primitives-only": "error" },
	},

	// The one sanctioned Tiptap importer: the canonical editor itself.
	{
		files: ["app/ui/rich-text.tsx"],
		rules: { "no-restricted-imports": "off" },
	},

	// Nav modules are client-bundled — pure data only (no runtime imports).
	{
		files: ["app/nav/*.nav.ts"],
		plugins: { openrostrum: openrostrumPlugin },
		rules: { "openrostrum/pure-nav-modules": "error" },
	},

	// Tests may normalize errors inline; proof-of-work test patterns are banned.
	{
		files: ["test/**/*.ts"],
		plugins: { openrostrum: openrostrumPlugin },
		rules: {
			"openrostrum/prefer-error-normalizer": "off",
			"openrostrum/meaningful-tests": "error",
		},
	},

	eslintConfigPrettier, // last: turn off stylistic rules (Biome formats)
];
