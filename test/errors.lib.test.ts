import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../app/db";
import { users } from "../app/db/schema";
import {
	errorChainIncludes,
	errorMessage,
	isUniqueViolation,
} from "../app/lib/errors";

// Regression pin for the signup race branch (and every other constraint
// catch): drizzle wraps the real D1 constraint text on the ERROR CAUSE CHAIN,
// not the top-level message. The old signup check —
// `errorMessage(error).includes("UNIQUE constraint failed: users.email")` —
// read only the top message, so the caught duplicate-insert race 500'd
// instead of steering to sign-in. This test throws the REAL drizzle/D1 error
// (an actual duplicate insert) and proves the chain-walking predicates see
// what the top-level read misses.

async function realUniqueViolation(): Promise<unknown> {
	const db = getDb(env);
	const row = {
		id: "u1",
		email: "dup@example.com",
		passwordHash: "x",
		role: "admin" as const,
	};
	await db.insert(users).values(row);
	try {
		await db.insert(users).values({ ...row, id: "u2" });
	} catch (error) {
		return error;
	}
	throw new Error("expected the duplicate insert to throw");
}

describe("constraint detection walks the real drizzle error shape", () => {
	it("finds users.email UNIQUE text on the cause chain where the top message lacks it", async () => {
		const error = await realUniqueViolation();
		// The fixed predicate (signup's race branch) sees the constraint…
		expect(
			errorChainIncludes(error, "UNIQUE constraint failed: users.email"),
		).toBe(true);
		expect(isUniqueViolation(error)).toBe(true);
		// …and the pre-fix check demonstrably could not: the constraint text
		// lives on the cause, not the top-level message this read.
		expect(
			errorMessage(error).includes("UNIQUE constraint failed: users.email"),
		).toBe(false);
	});

	it("does not flag an ordinary error", () => {
		const error = new Error("network flake", {
			cause: new Error("socket hang up"),
		});
		expect(isUniqueViolation(error)).toBe(false);
		expect(errorChainIncludes(error, "UNIQUE constraint failed")).toBe(false);
		expect(errorChainIncludes(error, "socket hang up")).toBe(true);
	});
});
