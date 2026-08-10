/** Minute-of-day → "9:30 AM". Pure math, identical on server and client. */
export function minutesToLabel(min: number): string {
	const h24 = Math.floor(min / 60) % 24;
	const m = min % 60;
	const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
	const suffix = h24 < 12 ? "AM" : "PM";
	return m === 0
		? `${h12} ${suffix}`
		: `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}
