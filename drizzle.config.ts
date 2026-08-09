import { defineConfig } from "drizzle-kit";

// D1 is SQLite. We only use drizzle-kit to *generate* SQL migrations from the
// schema; migrations are applied via `wrangler d1 migrations apply` (local and
// prod) so dev, tests, and prod share one mechanism. No CF credentials needed
// for generation. See docs/tech-stack.md.
export default defineConfig({
	dialect: "sqlite",
	schema: "./app/db/schema.ts",
	out: "./drizzle/migrations",
});
