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

	// React / hooks / a11y — only where components live.
	{ ...react.configs.flat.recommended, files: REACT },
	{ ...reactHooks.configs.flat["recommended-latest"], files: REACT },
	{ ...jsxA11y.flatConfigs.recommended, files: REACT },
	{
		files: REACT,
		plugins: { openrostrum: openrostrumPlugin },
		settings: { react: { version: "19.2.1" } },
		rules: {
			"openrostrum/no-raw-tailwind-colors": "error",
			"openrostrum/structured-tailwind-classname": "error",
			"react/react-in-jsx-scope": "off", // React 19 / RR7 — no import needed
			"react/prop-types": "off", // TypeScript handles this
		},
	},

	// Route modules (incl. .ts resource/API routes): an exported `action` must
	// authenticate (or opt out with a // @public comment), and UI is composed
	// from ~/ui primitives — no raw elements, skin classes, or inline style.
	{
		files: ["app/routes/**/*.{ts,tsx}"],
		plugins: { openrostrum: openrostrumPlugin },
		rules: {
			"openrostrum/require-auth-in-actions": "error",
			"openrostrum/ui-primitives-only": "error",
		},
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
