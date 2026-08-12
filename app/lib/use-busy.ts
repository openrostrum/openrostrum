import { useFetchers, useNavigation } from "react-router";

/**
 * The shared disabled-while-submitting guard: true while the pending navigation
 * OR any fetcher is in flight. Wire it to `disabled` on every mutating control
 * so a rapid double-click can't fire a second POST, and so parallel mutations
 * can't interleave (a draft save racing the final submit).
 */
export function useBusy(): boolean {
	const navigation = useNavigation();
	const fetchers = useFetchers();
	return (
		navigation.state !== "idle" || fetchers.some((f) => f.state !== "idle")
	);
}
