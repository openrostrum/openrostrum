import { useMemo, useState, useSyncExternalStore } from "react";
import { Field, Select } from "~/ui";

export const FALLBACK_TIMEZONE = "America/Los_Angeles";

let detected: string | null = null;

/** The browser's own zone is a client-only signal: the server cannot know it,
 * so it arrives as a store snapshot rather than a post-hydration setState —
 * React swaps it in on its own once the client takes over, with no cascading
 * render and no server/client markup disagreement. */
function browserTimezone(): string {
	if (detected) return detected;
	const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
	detected =
		guess && Intl.supportedValuesOf("timeZone").includes(guess)
			? guess
			: FALLBACK_TIMEZONE;
	return detected;
}

function serverTimezone(): string {
	return FALLBACK_TIMEZONE;
}

/** The zone never changes under us, so there is nothing to subscribe to. */
function subscribe(): () => void {
	return () => {};
}

/**
 * The one timezone picker. `value === null` means "nobody has answered yet" and
 * the browser's own zone is preselected; a stored answer always wins over the
 * guess. Controlled state rather than a ref because ~/ui primitives take no
 * ref; the server still renders a real selected option, so the field submits
 * correctly without JS.
 */
export function TimezoneSelect({
	value,
	error,
}: {
	value: string | null | undefined;
	error?: string;
}) {
	// A stored zone can be a legacy alias (`Asia/Calcutta`) that the canonical
	// list omits; keep it as an option so editing an unrelated field can't
	// silently rewrite it to whatever sorts first.
	const timeZones = useMemo(() => {
		const supported = Intl.supportedValuesOf("timeZone");
		return value && !supported.includes(value)
			? [value, ...supported]
			: supported;
	}, [value]);
	const guess = useSyncExternalStore(
		subscribe,
		browserTimezone,
		serverTimezone,
	);
	const [chosen, setChosen] = useState<string | null>(null);
	const selected = chosen ?? value ?? guess;

	return (
		<Field label="Timezone" error={error}>
			<Select
				name="timezone"
				required
				value={selected}
				onChange={(e) => setChosen(e.target.value)}
			>
				{timeZones.map((tz) => (
					<option key={tz} value={tz}>
						{tz.replaceAll("_", " ")}
					</option>
				))}
			</Select>
		</Field>
	);
}
