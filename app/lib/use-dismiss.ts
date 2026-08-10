import { useEffect, type RefObject } from "react";

/** Popover dismissal: pointerdown outside `ref` or Escape closes it. Shared
 * by every popover-style component (EventSwitcher, ThemeToggle). */
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
