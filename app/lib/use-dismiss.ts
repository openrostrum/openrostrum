import { useEffect, type RefObject } from "react";

/** The one popover-dismissal implementation — extend it here, never as a
 * private copy in a component. */
export function useDismiss(
	ref: RefObject<HTMLElement | null>,
	open: boolean,
	setOpen: (open: boolean) => void,
): void {
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open, ref, setOpen]);
}
