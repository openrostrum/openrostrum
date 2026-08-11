type FocusTarget = Pick<HTMLElement, "focus">;
type FocusPanel = FocusTarget & Pick<HTMLElement, "contains">;
type DialogKeyEvent = Pick<
	KeyboardEvent,
	"key" | "shiftKey" | "preventDefault"
>;

export function focusDialogInitial(
	panel: FocusTarget,
	candidates: HTMLElement[],
) {
	(candidates[0] ?? panel).focus();
}

export function handleDialogKeyDown({
	event,
	panel,
	candidates,
	active,
	onDismiss,
}: {
	event: DialogKeyEvent;
	panel: FocusPanel;
	candidates: HTMLElement[];
	active: Node | null;
	onDismiss?: () => void;
}) {
	if (event.key === "Escape" && onDismiss) {
		event.preventDefault();
		onDismiss();
		return;
	}
	if (event.key !== "Tab") return;
	if (candidates.length === 0) {
		event.preventDefault();
		panel.focus();
		return;
	}

	const first = candidates[0];
	const last = candidates[candidates.length - 1];
	if (!panel.contains(active)) {
		event.preventDefault();
		first?.focus();
	} else if (event.shiftKey && active === first) {
		event.preventDefault();
		last?.focus();
	} else if (!event.shiftKey && active === last) {
		event.preventDefault();
		first?.focus();
	}
}

export function restoreDialogFocus(previous: (FocusTarget & Node) | null) {
	if (previous?.isConnected) previous.focus();
}
