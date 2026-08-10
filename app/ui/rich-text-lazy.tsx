import {
	type ComponentProps,
	Suspense,
	lazy,
	useSyncExternalStore,
} from "react";

const Impl = lazy(() => import("./rich-text"));

const subscribeNoop = () => () => {};
const useHydrated = () =>
	useSyncExternalStore(
		subscribeNoop,
		() => true,
		() => false,
	);

/**
 * Tiptap must never enter the server module graph (SSR builds break on its
 * optimizer discovery) and is heavy on first paint — every consumer goes
 * through this client-only, code-split entry.
 */
export function RichText(props: ComponentProps<typeof Impl>) {
	const hydrated = useHydrated();
	const placeholder = (
		<div
			aria-hidden
			className="min-h-[132px] rounded-control border border-hair bg-surface"
		/>
	);
	if (!hydrated) return placeholder;
	return (
		<Suspense fallback={placeholder}>
			<Impl {...props} />
		</Suspense>
	);
}
