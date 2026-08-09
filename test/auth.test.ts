import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../app/lib/auth";

// The exact hash seeded in drizzle/seed.sql — asserting it verifies proves the
// seeded accounts can really log in (not a placeholder).
const SEED_HASH =
	"pbkdf2$600000$nRz+NCgbip51gWKmrtbi5w==$aFZ0QBI/rzxCV3+hHj/erqG1ONnn4A2G4nQVWa5QGlM=";

describe("auth (WebCrypto PBKDF2 in workerd)", () => {
	it("hashes and verifies a password round-trip", async () => {
		const hash = await hashPassword("hunter2");
		expect(await verifyPassword("hunter2", hash)).toBe(true);
		expect(await verifyPassword("wrong", hash)).toBe(false);
	});

	it("verifies the seed hash matches 'password'", async () => {
		expect(await verifyPassword("password", SEED_HASH)).toBe(true);
	});
});
