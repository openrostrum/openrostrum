/**
 * Inject time so reminder/close-date logic is testable: pass a Clock into any
 * code that branches on "now" instead of calling `new Date()` directly.
 */
export interface Clock {
	now(): Date;
}

export const systemClock: Clock = {
	now: () => new Date(),
};

export function fixedClock(instant: Date): Clock {
	return { now: () => instant };
}
