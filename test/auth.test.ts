import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../app/lib/auth";

// The exact hash seeded in drizzle/seed.sql — asserting it verifies proves the
// seeded accounts can really log in (not a placeholder).
const SEED_HASH =
	"pbkdf2$100000$tYODZFeVCKLS/9d5yr3MNA==$wA4J7qHKFSGJ5wmrueLaEmZr3PgeC2NSGokpxOmnE24=";

// Cloudflare Workers' WebCrypto hard-caps PBKDF2 at this many iterations; a hash
// above it throws NotSupportedError in production (workerd locally does NOT
// enforce it, which is exactly why this regression is asserted on the COUNT).
const WORKERS_PBKDF2_MAX = 100_000;

describe("auth (WebCrypto PBKDF2 in workerd)", () => {
	it("hashes and verifies a password round-trip", async () => {
		const hash = await hashPassword("hunter2");
		expect(await verifyPassword("hunter2", hash)).toBe(true);
		expect(await verifyPassword("wrong", hash)).toBe(false);
	});

	it("hashes at or below the Workers PBKDF2 iteration cap", async () => {
		const iterations = Number((await hashPassword("x")).split("$")[1]);
		expect(iterations).toBeLessThanOrEqual(WORKERS_PBKDF2_MAX);
	});

	it("verifies the seed hash matches 'password'", async () => {
		expect(await verifyPassword("password", SEED_HASH)).toBe(true);
	});
});
