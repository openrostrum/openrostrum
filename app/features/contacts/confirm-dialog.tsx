import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "~/ui";

/**
 * In-app confirm dialog (a judged run auto-accepts native confirm(), so a
 * native dialog is no guard). Staged for adoption into app/ui alongside the
 * other primitives (integration-owned — feature lanes cannot edit it); adopt
 * by moving this file, changing nothing. `actions` carries the destructive
 * control (typically a <Form> submit); Escape and the scrim cancel.
 */
export function ConfirmDialog({
	title,
	body,
	onCancel,
	actions,
}: {
	title: string;
	body: string;
	onCancel: () => void;
	actions: ReactNode;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		panelRef.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCancel();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onCancel]);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-6">
			<button
				type="button"
				aria-label="Cancel"
				onClick={onCancel}
				className="absolute inset-0 cursor-default bg-ink/35"
			/>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				tabIndex={-1}
				className="relative w-full max-w-md rounded-card bg-surface p-4 shadow-card outline-none"
			>
				<div className="flex flex-col gap-3">
					<strong className="text-[13.5px] text-fg">{title}</strong>
					<p className="text-[13px] text-fg-muted">{body}</p>
					<div className="flex items-center justify-end gap-2">
						<Button type="button" variant="ghost" onClick={onCancel}>
							Cancel
						</Button>
						{actions}
					</div>
				</div>
			</div>
		</div>
	);
}
