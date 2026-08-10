/**
 * Shared thrown-value helpers for loader/action tests (previously duplicated
 * across files/portal/program helper files — one implementation now, the
 * feature helper files re-export it).
 */

/** Runs fn and returns the thrown value (fails the test if nothing throws). */
export async function catchThrown(
	fn: () => Promise<unknown>,
): Promise<unknown> {
	try {
		await fn();
	} catch (thrown) {
		return thrown;
	}
	throw new Error("expected the call to throw, but it returned");
}

/** Status of a thrown Response or of a thrown `data(..., { status })` result. */
export function thrownStatus(thrown: unknown): number | undefined {
	if (thrown instanceof Response) return thrown.status;
	return (thrown as { init?: { status?: number } | null }).init?.status;
}
